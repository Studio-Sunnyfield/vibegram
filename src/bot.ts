import { Bot, InlineKeyboard, type Context } from "grammy";
import { ClaudeAgent, OpenCodeAgent } from "./agent";
import type { CodingAgent, NormalizedEvent, AgentOptions } from "./agent";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { formatToolUse, stripThinkingTags } from "./utils";

interface BotConfig {
  token: string;
  allowedUserId: number;
  projectRoot?: string;
  streamMode?: "compact" | "full";
  agent?: "claude" | "opencode";
}

interface UserSession {
  agent: CodingAgent | null;
  sessionId: string | null;
  cwd: string;
  statusMsgId: number | null;
  outputMsgId: number | null;
  responseMsgId: number | null;
  lastStatus: string;
  isProcessing: boolean;
}

const longMessages = new Map<string, string>();

export function createBot(config: BotConfig): Bot {
  const bot = new Bot(config.token);
  const sessions = new Map<number, UserSession>();

  function getSession(userId: number): UserSession {
    if (!sessions.has(userId)) {
      sessions.set(userId, {
        agent: null,
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

  async function killAgent(session: UserSession): Promise<void> {
    if (session.agent) {
      await session.agent.stop();
      session.agent = null;
    }
    session.sessionId = null;
    session.isProcessing = false;
  }

  function resetMessageBlocks(session: UserSession): void {
    session.statusMsgId = null;
    session.outputMsgId = null;
    session.responseMsgId = null;
    session.lastStatus = "";
  }

  function createAgent(options: AgentOptions, onEvent: (event: NormalizedEvent) => void): CodingAgent {
    if (config.agent === "opencode") {
      return new OpenCodeAgent(options, onEvent);
    }
    return new ClaudeAgent(options, onEvent);
  }

  // Debug middleware
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

  bot.command("new", async (ctx) => {
    const session = getSession(ctx.from!.id);
    await killAgent(session);
    await ctx.reply("Started new conversation.");
  });

  bot.command("stop", async (ctx) => {
    const session = getSession(ctx.from!.id);
    if (session.isProcessing) {
      await killAgent(session);
      await ctx.reply("Stopped. Use /resume to continue.");
    } else {
      await ctx.reply("No task running.");
    }
  });

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

  bot.command("resume", async (ctx) => {
    const session = getSession(ctx.from!.id);
    await killAgent(session);
    session.sessionId = "continue";

    const summary = getLastSessionSummary(session.cwd);
    let msg = `📂 \`${session.cwd}\`\n`;
    if (summary) {
      msg += `\n📋 *Last session:*\n${summary}\n`;
    }
    msg += `\nSend a message to continue.`;

    await ctx.reply(msg, { parse_mode: "Markdown" });
  });

  bot.command("cd", async (ctx) => {
    const session = getSession(ctx.from!.id);
    let targetPath = ctx.match?.trim();
    if (!targetPath) {
      await ctx.reply(`Current directory: \`${session.cwd}\`\n\nUsage: \`/cd <path>\``, {
        parse_mode: "Markdown",
      });
      return;
    }

    if (targetPath.startsWith("~")) {
      targetPath = targetPath.replace("~", process.env.HOME || "");
    }
    if (!targetPath.startsWith("/")) {
      targetPath = `${session.cwd}/${targetPath}`;
    }

    if (session.agent) {
      await session.agent.stop();
      session.agent = null;
    }
    session.sessionId = null;
    session.cwd = targetPath;

    await ctx.reply(`Changed to: \`${targetPath}\``, { parse_mode: "Markdown" });
  });

  bot.hears(/^!(.+)/, async (ctx) => {
    const session = getSession(ctx.from!.id);
    const command = ctx.match[1];

    if (command.startsWith("cd ")) {
      let targetPath = command.slice(3).trim();
      if (targetPath.startsWith("~")) {
        targetPath = targetPath.replace("~", process.env.HOME || "");
      }
      if (!targetPath.startsWith("/")) {
        targetPath = `${session.cwd}/${targetPath}`;
      }
      const parts = targetPath.split("/").filter(Boolean);
      const resolved: string[] = [];
      for (const part of parts) {
        if (part === "..") resolved.pop();
        else if (part !== ".") resolved.push(part);
      }
      session.cwd = "/" + resolved.join("/");
      await killAgent(session);
      await ctx.reply(`\`${session.cwd}\``, { parse_mode: "Markdown" });
      return;
    }

    exec(command, { cwd: session.cwd }, async (error, stdout, stderr) => {
      let output = stdout || stderr || "(no output)";
      if (output.length > 4000) {
        output = output.slice(0, 4000) + "\n... (truncated)";
      }
      const status = error ? `\n\n[exit ${error.code}]` : "";
      await ctx.reply(`\`\`\`\n${output}${status}\n\`\`\``, { parse_mode: "Markdown" });
    });
  });

  bot.on("message:photo", async (ctx) => {
    const session = getSession(ctx.from!.id);
    const caption = ctx.message.caption || "What's in this image?";

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${config.token}/${file.file_path}`;

    const tempPath = `/tmp/tgcc_image_${Date.now()}.jpg`;
    const https = await import("https");
    const fsModule = await import("fs");

    await new Promise<void>((resolve, reject) => {
      const fileStream = fsModule.createWriteStream(tempPath);
      https.get(fileUrl, (response) => {
        response.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });
      }).on("error", reject);
    });

    await handleMessage(ctx, session, caption, tempPath);
  });

  bot.on("message:text", async (ctx) => {
    const session = getSession(ctx.from!.id);
    const text = ctx.message.text;
    await handleMessage(ctx, session, text);
  });

  async function handleMessage(ctx: Context, session: UserSession, text: string, imagePath?: string) {
    if (session.isProcessing && session.agent) {
      await session.agent.sendMessage(text, imagePath);
      return;
    }

    session.isProcessing = true;
    resetMessageBlocks(session);

    const statusMsg = await ctx.reply("💭 Thinking...");
    session.statusMsgId = statusMsg.message_id;
    session.lastStatus = "Thinking...";

    const isFullMode = config.streamMode === "full";

    const handleEvent = async (event: NormalizedEvent) => {
      await processNormalizedEvent(ctx, session, event, isFullMode);
    };

    const options: AgentOptions = {
      cwd: session.cwd,
      permissionMode: "bypassPermissions",
      sessionId: session.sessionId || undefined,
    };

    session.agent = createAgent(options, handleEvent);

    session.agent.setOnClose(async (code, stderr) => {
      if (session.isProcessing) {
        session.isProcessing = false;
        const errorMsg = stderr.trim() || `Process exited with code ${code}`;
        console.error("Agent exited while processing:", errorMsg);
        await updateStatusBlock(ctx, session, `❌ Crashed`);
        if (errorMsg.length > 0 && errorMsg.length < 500) {
          await ctx.reply(`\`\`\`\n${errorMsg}\n\`\`\``, { parse_mode: "Markdown" });
        }
      }
    });

    try {
      await session.agent.start(text, imagePath);
    } catch (e) {
      console.error("Failed to start agent:", e);
      await ctx.reply("❌ Error: " + e);
      session.isProcessing = false;
    }
  }

  return bot;
}

async function processNormalizedEvent(
  ctx: Context,
  session: UserSession,
  event: NormalizedEvent,
  isFullMode: boolean
): Promise<void> {
  switch (event.type) {
    case "init":
      session.sessionId = event.sessionId;
      break;

    case "tool_use": {
      const toolDisplay = formatToolUse({
        type: "tool_use",
        id: "",
        name: event.tool,
        input: event.input || {},
      });
      session.lastStatus = toolDisplay;
      if (isFullMode) {
        await ctx.reply(`🔧 ${toolDisplay}`);
      } else {
        await updateStatusBlock(ctx, session, `🔧 ${toolDisplay}`);
      }
      break;
    }

    case "tool_output": {
      if (event.output?.trim()) {
        if (isFullMode) {
          let text = event.output.trim();
          if (text.length > 1000) {
            text = text.slice(0, 1000) + "\n... (truncated)";
          }
          await ctx.reply(`📤 \`\`\`\n${text}\n\`\`\``, { parse_mode: "Markdown" });
        } else {
          await updateOutputBlock(ctx, session, event.output);
        }
      }
      break;
    }

    case "text": {
      const text = stripThinkingTags(event.content || "");
      if (text) {
        if (isFullMode) {
          await ctx.reply(`💬 ${text}`, { parse_mode: "Markdown" }).catch(() =>
            ctx.reply(`💬 ${text}`)
          );
        } else {
          await updateStatusBlock(ctx, session, "💭 Responding...");
          await updateResponseBlock(ctx, session, text);
        }
      }
      break;
    }

    case "error":
      await ctx.reply(`❌ Error: ${event.content}`);
      break;

    case "done":
      session.isProcessing = false;
      if (isFullMode) {
        const duration = event.durationMs ? `(${(event.durationMs / 1000).toFixed(1)}s)` : "";
        await ctx.reply(`✅ Done ${duration}`);
      } else {
        if (session.statusMsgId) {
          await updateStatusBlock(ctx, session, `✅ Done`);
        }
      }
      if (event.isError && event.content) {
        await ctx.reply(`❌ Error: ${event.content}`);
      }
      break;
  }
}

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
      const msg = await ctx.reply(formatted, { parse_mode: "Markdown" });
      session.outputMsgId = msg.message_id;
    }
  } else {
    const msg = await ctx.reply(formatted, { parse_mode: "Markdown" });
    session.outputMsgId = msg.message_id;
  }
}

async function updateResponseBlock(
  ctx: Context,
  session: UserSession,
  text: string
): Promise<void> {
  const formatted = `💬 ${text}`;

  async function sendWithFallback(content: string, keyboard?: InlineKeyboard): Promise<number> {
    try {
      const msg = await ctx.reply(content, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return msg.message_id;
    } catch {
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
