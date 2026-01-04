import { Bot, InlineKeyboard, type Context } from "grammy";
import { ClaudeProcess, type ClaudeProcessOptions } from "./claude";
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
}

// Format timestamp as relative time
function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface SessionHistory {
  id: string;
  cwd: string;
  timestamp: number;
}

interface UserSession {
  claude: ClaudeProcess | null;
  sessionId: string | null;
  sessionHistory: SessionHistory[]; // For /resume
  cwd: string;
  statusMessageId: number | null;
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
        sessionHistory: [],
        cwd: process.env.HOME || "/",
        statusMessageId: null,
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
    if (session.sessionId) {
      // Add to history (keep last 5)
      session.sessionHistory = [
        { id: session.sessionId, cwd: session.cwd, timestamp: Date.now() },
        ...session.sessionHistory,
      ].slice(0, 5);
      session.sessionId = null;
    }
    session.isProcessing = false;
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
    session.sessionHistory = []; // Clear resume history too
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
    // Edit the message to show full text (remove the button)
    try {
      await ctx.editMessageText(fullText, { parse_mode: "Markdown" });
    } catch {
      // If too long for edit, send as new message
      await ctx.reply(fullText, { parse_mode: "Markdown" });
    }
    longMessages.delete(msgId);
  });

  // /resume command - continue most recent session in current directory
  bot.command("resume", async (ctx) => {
    const session = getSession(ctx.from!.id);

    // Kill current if any
    await killClaude(session);

    // Set special "continue" flag
    session.sessionId = "continue";

    await ctx.reply(
      `Will continue most recent session in \`${session.cwd}\`\nSend a message to continue.`,
      { parse_mode: "Markdown" }
    );
  });

  // /cd command - change working directory
  bot.command("cd", async (ctx) => {
    const session = getSession(ctx.from!.id);
    let path = ctx.match?.trim();
    if (!path) {
      await ctx.reply(`Current directory: \`${session.cwd}\`\n\nUsage: \`/cd <path>\``, {
        parse_mode: "Markdown",
      });
      return;
    }

    // Expand ~ to home directory
    if (path.startsWith("~")) {
      path = path.replace("~", process.env.HOME || "");
    }

    // Handle relative paths
    if (!path.startsWith("/")) {
      path = `${session.cwd}/${path}`;
    }

    // Reset session when changing directory
    if (session.claude) {
      await session.claude.stop();
      session.claude = null;
    }
    session.sessionId = null;
    session.cwd = path;

    await ctx.reply(`Changed to: \`${path}\``, {
      parse_mode: "Markdown",
    });
  });

  // Handle ! prefix for direct bash commands
  bot.hears(/^!(.+)/, async (ctx) => {
    const session = getSession(ctx.from!.id);
    const command = ctx.match[1];

    // Handle !cd specially - change session cwd and kill Claude
    if (command.startsWith("cd ")) {
      let path = command.slice(3).trim();
      if (path.startsWith("~")) {
        path = path.replace("~", process.env.HOME || "");
      }
      if (!path.startsWith("/")) {
        path = `${session.cwd}/${path}`;
      }
      // Normalize path (resolve ..)
      const parts = path.split("/").filter(Boolean);
      const resolved: string[] = [];
      for (const part of parts) {
        if (part === "..") resolved.pop();
        else if (part !== ".") resolved.push(part);
      }
      session.cwd = "/" + resolved.join("/");

      // Kill Claude so next message spawns in new directory
      await killClaude(session);

      await ctx.reply(`\`${session.cwd}\``, { parse_mode: "Markdown" });
      return;
    }

    // Run bash command
    const proc = Bun.spawn(["bash", "-c", command], {
      cwd: session.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    let output = stdout || stderr || "(no output)";
    if (output.length > 4000) {
      output = output.slice(0, 4000) + "\n... (truncated)";
    }

    const status = exitCode === 0 ? "" : `\n\n[exit ${exitCode}]`;
    await ctx.reply(`\`\`\`\n${output}${status}\n\`\`\``, { parse_mode: "Markdown" });
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const session = getSession(ctx.from!.id);
    const text = ctx.message.text;

    // If already processing, append to context
    if (session.isProcessing && session.claude) {
      await session.claude.sendMessage(text);
      return;
    }

    session.isProcessing = true;

    // Send thinking indicator
    const statusMsg = await ctx.reply("Thinking...");
    session.statusMessageId = statusMsg.message_id;

    // Create event handler
    const handleEvent = async (event: ClaudeEvent) => {
      await processEvent(ctx, session, event);
    };

    // Start Claude process
    const options: ClaudeProcessOptions = {
      cwd: session.cwd,
      permissionMode: "acceptEdits",
      sessionId: session.sessionId || undefined,
    };

    session.claude = new ClaudeProcess(options, handleEvent);

    try {
      await session.claude.start(text);
    } catch (e) {
      console.error("Failed to start Claude:", e);
      await ctx.reply(`Error: ${e}`);
      session.isProcessing = false;
    }
  });

  return bot;
}

// Process Claude events and update Telegram
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
          await updateStatusMessage(ctx, session, `Running: ${toolDisplay}`);
        } else if (content.type === "text") {
          const textContent = content as TextContent;
          // Filter out <thinking> tags and their content
          const text = textContent.text
            .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
            .trim();
          // Send if there's content left
          if (text) {
            // Truncate long messages with "Show more" button
            if (text.length > 1500) {
              const truncated = text.slice(0, 1500) + "\n\n...";
              const msgId = `msg_${Date.now()}`;
              longMessages.set(msgId, text);
              // Clean up old messages (keep last 20)
              if (longMessages.size > 20) {
                const firstKey = longMessages.keys().next().value;
                if (firstKey) longMessages.delete(firstKey);
              }
              const keyboard = new InlineKeyboard().text("Show full message", `expand:${msgId}`);
              await ctx.reply(truncated, { parse_mode: "Markdown", reply_markup: keyboard });
            } else {
              await ctx.reply(text, { parse_mode: "Markdown" });
            }
          }
        }
      }
      break;
    }

    case "user": {
      // Tool results - optionally show truncated output
      const userEvent = event as UserEvent;
      if (userEvent.tool_use_result) {
        const output = userEvent.tool_use_result.stdout;
        if (output && output.length > 200) {
          // Only show if significant output
          await updateStatusMessage(ctx, session, `Output: ${output.slice(0, 100)}...`);
        }
      }
      break;
    }

    case "result": {
      const resultEvent = event as ResultEvent;
      session.isProcessing = false;

      // Delete status message
      if (session.statusMessageId) {
        try {
          await ctx.api.deleteMessage(chatId, session.statusMessageId);
        } catch {
          // Ignore deletion errors
        }
        session.statusMessageId = null;
      }

      // Only show error if there is one
      if (resultEvent.is_error) {
        await ctx.reply(`Error: ${resultEvent.result}`);
      }
      break;
    }
  }
}

// Format tool use for display
function formatToolUse(tool: ToolUseContent): string {
  const name = tool.name;
  const input = tool.input;

  switch (name) {
    case "Bash":
      return `\`${(input as { command?: string }).command || name}\``;
    case "Read":
      return `Reading \`${(input as { file_path?: string }).file_path}\``;
    case "Edit":
      return `Editing \`${(input as { file_path?: string }).file_path}\``;
    case "Write":
      return `Writing \`${(input as { file_path?: string }).file_path}\``;
    case "Glob":
      return `Searching \`${(input as { pattern?: string }).pattern}\``;
    case "Grep":
      return `Grepping \`${(input as { pattern?: string }).pattern}\``;
    default:
      return name;
  }
}

// Update the status message in place
async function updateStatusMessage(
  ctx: Context,
  session: UserSession,
  text: string
): Promise<void> {
  if (session.statusMessageId) {
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        session.statusMessageId,
        text
      );
    } catch {
      // Ignore edit errors (message unchanged, etc)
    }
  }
}
