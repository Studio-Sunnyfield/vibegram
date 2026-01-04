import { Bot, InlineKeyboard, type Context } from "grammy";
import { ClaudeProcess, type ClaudeProcessOptions } from "./claude";
import { execSync, exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { formatToolUse, stripThinkingTags, resolvePath } from "./utils";
import type {
  ClaudeEvent,
  AssistantEvent,
  UserEvent,
  ResultEvent,
  SystemInitEvent,
  ToolUseContent,
  TextContent,
} from "./types";

interface BotConfig {
  token: string;
  allowedUserId: number;
  projectRoot?: string;
}

interface UserSession {
  claude: ClaudeProcess | null;
  sessionId: string | null;
  cwd: string;
  // Message IDs for the 3 blocks
  statusMsgId: number | null;
  outputMsgId: number | null;
  responseMsgId: number | null;
  // Current status text
  lastStatus: string;
  isProcessing: boolean;
}

// Store long messages for "Show more" buttons
const longMessages = new Map<string, string>();

export function createBot(config: BotConfig): Bot {
  const bot = new Bot(config.token);
  const sessions = new Map<number, UserSession>();

  // Get or create session for user
  function getSession(userId: number): UserSession {
    if (!sessions.has(userId)) {
      sessions.set(userId, {
        claude: null,
        sessionId: null,
        cwd: config.projectRoot || process.env.HOME || "/",
        statusMsgId: null,
        outputMsgId: null,
        responseMsgId: null,
        lastStatus: "",
        isProcessing: false,
      });
    }
    return sessions.get(userId)!;
  }

  // Kill Claude and save session for resume
  async function killClaude(session: UserSession): Promise<void> {
    if (session.claude) {
      await session.claude.stop();
      session.claude = null;
    }
    session.sessionId = null;
    session.isProcessing = false;
  }

  // Reset message blocks for new request
  function resetMessageBlocks(session: UserSession): void {
    session.statusMsgId = null;
    session.outputMsgId = null;
    session.responseMsgId = null;
    session.lastStatus = "";
  }

  // Debug: log all updates
  bot.use(async (ctx, next) => {
    console.log(`[UPDATE] ${ctx.update.update_id} from ${ctx.from?.id} (${ctx.from?.username})`);
    await next();
  });

  // Auth middleware
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId !== config.allowedUserId) {
      console.log(`[AUTH] Denied: ${userId} != ${config.allowedUserId}`);
      return;
    }
    console.log(`[AUTH] Allowed: ${userId}`);
    await next();
  });

  // /start command
  bot.command("start", async (ctx) => {
    const session = getSession(ctx.from!.id);
    await ctx.reply(
      `*Claude Code Bridge*\n\n` +
        `Send me a message and I'll process it with Claude Code.\n\n` +
        `*Commands:*\n` +
        `/new - Start new conversation\n` +
        `/stop - Stop current task\n` +
        `/status - Show current status\n` +
        `/cd <path> - Change working directory\n\n` +
        `Current directory: \`${session.cwd}\``,
      { parse_mode: "Markdown" }
    );
  });

  // /new command - clear session
  bot.command("new", async (ctx) => {
    const session = getSession(ctx.from!.id);
    await killClaude(session);
    await ctx.reply("Started new conversation.");
  });

  // /stop command
  bot.command("stop", async (ctx) => {
    const session = getSession(ctx.from!.id);
    if (session.isProcessing) {
      await killClaude(session);
      await ctx.reply("Stopped. Use /resume to continue.");
    } else {
      await ctx.reply("No task running.");
    }
  });

  // /status command
  bot.command("status", async (ctx) => {
    const session = getSession(ctx.from!.id);
    const status = [
      `*Status*`,
      `Project: \`${session.cwd}\``,
      `Session: ${session.sessionId ? `\`${session.sessionId.slice(0, 8)}...\`` : "none"}`,
      `Processing: ${session.isProcessing ? "yes" : "no"}`,
    ].join("\n");
    await ctx.reply(status, { parse_mode: "Markdown" });
  });

  // Handle "Show full message" callback
  bot.callbackQuery(/^expand:(.+)/, async (ctx) => {
    const msgId = ctx.match[1];
    const fullText = longMessages.get(msgId);

    if (!fullText) {
      await ctx.answerCallbackQuery("Message expired");
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageText(fullText, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(fullText, { parse_mode: "Markdown" });
    }
    longMessages.delete(msgId);
  });

  // Helper to get last session summary
  function getLastSessionSummary(cwd: string): string | null {
    try {
      const projectKey = cwd.replace(/\//g, "-");
      const sessionDir = path.join(
        process.env.HOME || "",
        ".claude",
        "projects",
        projectKey
      );
      if (!fs.existsSync(sessionDir)) return null;

      // Find most recent non-empty .jsonl file
      const files = fs
        .readdirSync(sessionDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({
          name: f,
          path: path.join(sessionDir, f),
          mtime: fs.statSync(path.join(sessionDir, f)).mtime,
          size: fs.statSync(path.join(sessionDir, f)).size,
        }))
        .filter((f) => f.size > 0)
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      if (files.length === 0) return null;

      // Read the file and find last summary
      const content = fs.readFileSync(files[0].path, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(lines[i]);
          if (obj.summary) return obj.summary;
        } catch {
          continue;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // /resume command
  bot.command("resume", async (ctx) => {
    const session = getSession(ctx.from!.id);
    await killClaude(session);
    session.sessionId = "continue";

    const summary = getLastSessionSummary(session.cwd);
    let msg = `📂 \`${session.cwd}\`\n`;
    if (summary) {
      msg += `\n📋 *Last session:*\n${summary}\n`;
    }
    msg += `\nSend a message to continue.`;

    await ctx.reply(msg, { parse_mode: "Markdown" });
  });

  // /cd command
  bot.command("cd", async (ctx) => {
    const session = getSession(ctx.from!.id);
    let path = ctx.match?.trim();
    if (!path) {
      await ctx.reply(`Current directory: \`${session.cwd}\`\n\nUsage: \`/cd <path>\``, {
        parse_mode: "Markdown",
      });
      return;
    }

    if (path.startsWith("~")) {
      path = path.replace("~", process.env.HOME || "");
    }
    if (!path.startsWith("/")) {
      path = `${session.cwd}/${path}`;
    }

    if (session.claude) {
      await session.claude.stop();
      session.claude = null;
    }
    session.sessionId = null;
    session.cwd = path;

    await ctx.reply(`Changed to: \`${path}\``, { parse_mode: "Markdown" });
  });

  // Handle ! prefix for direct bash commands
  bot.hears(/^!(.+)/, async (ctx) => {
    const session = getSession(ctx.from!.id);
    const command = ctx.match[1];

    // Handle !cd specially
    if (command.startsWith("cd ")) {
      let path = command.slice(3).trim();
      if (path.startsWith("~")) {
        path = path.replace("~", process.env.HOME || "");
      }
      if (!path.startsWith("/")) {
        path = `${session.cwd}/${path}`;
      }
      const parts = path.split("/").filter(Boolean);
      const resolved: string[] = [];
      for (const part of parts) {
        if (part === "..") resolved.pop();
        else if (part !== ".") resolved.push(part);
      }
      session.cwd = "/" + resolved.join("/");
      await killClaude(session);
      await ctx.reply(`\`${session.cwd}\``, { parse_mode: "Markdown" });
      return;
    }

    // Run bash command using Node.js
    exec(command, { cwd: session.cwd }, async (error, stdout, stderr) => {
      let output = stdout || stderr || "(no output)";
      if (output.length > 4000) {
        output = output.slice(0, 4000) + "\n... (truncated)";
      }
      const status = error ? `\n\n[exit ${error.code}]` : "";
      await ctx.reply(`\`\`\`\n${output}${status}\n\`\`\``, { parse_mode: "Markdown" });
    });
  });

  // Handle photo messages
  bot.on("message:photo", async (ctx) => {
    const session = getSession(ctx.from!.id);
    const caption = ctx.message.caption || "What's in this image?";

    // Get the largest photo
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${config.token}/${file.file_path}`;

    // Download to temp file
    const tempPath = `/tmp/tgcc_image_${Date.now()}.jpg`;
    const https = await import("https");
    const fs = await import("fs");

    await new Promise<void>((resolve, reject) => {
      const fileStream = fs.createWriteStream(tempPath);
      https.get(fileUrl, (response) => {
        response.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });
      }).on("error", reject);
    });

    // Send to Claude with image
    await handleMessage(ctx, session, caption, tempPath);
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const session = getSession(ctx.from!.id);
    const text = ctx.message.text;
    await handleMessage(ctx, session, text);
  });

  // Shared message handler
  async function handleMessage(ctx: Context, session: UserSession, text: string, imagePath?: string) {
    if (session.isProcessing && session.claude) {
      await session.claude.sendMessage(text, imagePath);
      return;
    }

    session.isProcessing = true;
    resetMessageBlocks(session);

    // Send initial status (no parse_mode to ensure emoji shows)
    const statusMsg = await ctx.reply("💭 Thinking...");
    session.statusMsgId = statusMsg.message_id;
    session.lastStatus = "Thinking...";

    const handleEvent = async (event: ClaudeEvent) => {
      await processEvent(ctx, session, event);
    };

    const options: ClaudeProcessOptions = {
      cwd: session.cwd,
      permissionMode: "bypassPermissions",
      sessionId: session.sessionId || undefined,
    };

    session.claude = new ClaudeProcess(options, handleEvent);

    try {
      await session.claude.start(text, imagePath);
    } catch (e) {
      console.error("Failed to start Claude:", e);
      await ctx.reply("❌ Error: " + e);
      session.isProcessing = false;
    }
  }

  return bot;
}

async function processEvent(
  ctx: Context,
  session: UserSession,
  event: ClaudeEvent
): Promise<void> {
  const chatId = ctx.chat!.id;

  switch (event.type) {
    case "system": {
      const sysEvent = event as SystemInitEvent;
      if (sysEvent.subtype === "init") {
        session.sessionId = sysEvent.session_id;
      }
      break;
    }

    case "assistant": {
      const assistantEvent = event as AssistantEvent;
      for (const content of assistantEvent.message.content) {
        if (content.type === "tool_use") {
          const toolContent = content as ToolUseContent;
          const toolDisplay = formatToolUse(toolContent);
          session.lastStatus = toolDisplay;
          await updateStatusBlock(ctx, session, `🔧 ${toolDisplay}`);
        } else if (content.type === "text") {
          const textContent = content as TextContent;
          const text = stripThinkingTags(textContent.text);
          if (text) {
            await updateStatusBlock(ctx, session, "💭 Responding...");
            await updateResponseBlock(ctx, session, text);
          }
        }
      }
      break;
    }

    case "user": {
      const userEvent = event as UserEvent;
      if (userEvent.tool_use_result) {
        const output = userEvent.tool_use_result.stdout || userEvent.tool_use_result.stderr;
        if (output && output.trim()) {
          await updateOutputBlock(ctx, session, output);
        }
        // Keep showing working status (don't flip to ✅ yet)
      }
      break;
    }

    case "result": {
      const resultEvent = event as ResultEvent;
      session.isProcessing = false;

      // Final status update
      if (session.statusMsgId) {
        await updateStatusBlock(ctx, session, `✅ Done`);
      }

      if (resultEvent.is_error) {
        await ctx.reply(`❌ Error: ${resultEvent.result}`);
      }
      break;
    }
  }
}


// Update or create the status block
async function updateStatusBlock(
  ctx: Context,
  session: UserSession,
  text: string
): Promise<void> {
  if (session.statusMsgId) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, session.statusMsgId, text);
    } catch {
      // Ignore edit errors
    }
  }
}

// Update or create the output block
async function updateOutputBlock(
  ctx: Context,
  session: UserSession,
  output: string
): Promise<void> {
  let text = output.trim();
  if (text.length > 1000) {
    text = text.slice(0, 1000) + "\n... (truncated)";
  }
  const formatted = `📤 \`\`\`\n${text}\n\`\`\``;

  if (session.outputMsgId) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, session.outputMsgId, formatted, {
        parse_mode: "Markdown",
      });
    } catch {
      // If edit fails, send new message
      const msg = await ctx.reply(formatted, { parse_mode: "Markdown" });
      session.outputMsgId = msg.message_id;
    }
  } else {
    const msg = await ctx.reply(formatted, { parse_mode: "Markdown" });
    session.outputMsgId = msg.message_id;
  }
}

// Update or create the response block
async function updateResponseBlock(
  ctx: Context,
  session: UserSession,
  text: string
): Promise<void> {
  const formatted = `💬 ${text}`;

  // Helper to send message with Markdown fallback to plain text
  async function sendWithFallback(content: string, keyboard?: InlineKeyboard): Promise<number> {
    try {
      const msg = await ctx.reply(content, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return msg.message_id;
    } catch {
      // Markdown failed, send as plain text
      const msg = await ctx.reply(content, { reply_markup: keyboard });
      return msg.message_id;
    }
  }

  async function editWithFallback(msgId: number, content: string, keyboard?: InlineKeyboard): Promise<boolean> {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, msgId, content, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
      return true;
    } catch {
      try {
        await ctx.api.editMessageText(ctx.chat!.id, msgId, content, {
          reply_markup: keyboard,
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  // For long messages, use collapsible
  if (text.length > 1500) {
    const truncated = `💬 ${text.slice(0, 1500)}\n\n...`;
    const msgId = `msg_${Date.now()}`;
    longMessages.set(msgId, formatted);
    if (longMessages.size > 20) {
      const firstKey = longMessages.keys().next().value;
      if (firstKey) longMessages.delete(firstKey);
    }
    const keyboard = new InlineKeyboard().text("Show full message", `expand:${msgId}`);

    if (session.responseMsgId) {
      const edited = await editWithFallback(session.responseMsgId, truncated, keyboard);
      if (!edited) {
        session.responseMsgId = await sendWithFallback(truncated, keyboard);
      }
    } else {
      session.responseMsgId = await sendWithFallback(truncated, keyboard);
    }
  } else {
    if (session.responseMsgId) {
      const edited = await editWithFallback(session.responseMsgId, formatted);
      if (!edited) {
        session.responseMsgId = await sendWithFallback(formatted);
      }
    } else {
      session.responseMsgId = await sendWithFallback(formatted);
    }
  }
}
