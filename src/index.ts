import { createBot } from "./bot";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Config directory for Electron app
const configDir = path.join(os.homedir(), "Library", "Application Support", "Vibegram");
const configPath = path.join(configDir, "config.json");

interface Config {
  token: string;
  allowedUserId: number;
  projectRoot: string;
  streamMode?: "compact" | "full";
}

function loadConfig(): Config | null {
  // First try config.json (Electron app)
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      // Fall through to .env
    }
  }

  // Fall back to .env (local dev)
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, "utf-8");
    const envVars: Record<string, string> = {};
    for (const line of envFile.split("\n")) {
      const [key, ...rest] = line.split("=");
      if (key && rest.length) {
        envVars[key.trim()] = rest.join("=").trim();
      }
    }
    const token = envVars.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const allowedUserId = envVars.TELEGRAM_ALLOWED_USER_ID || process.env.TELEGRAM_ALLOWED_USER_ID;
    if (token && allowedUserId) {
      return {
        token,
        allowedUserId: parseInt(allowedUserId, 10),
        projectRoot: process.env.HOME || "/",
      };
    }
  }

  // Try environment variables directly
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALLOWED_USER_ID) {
    return {
      token: process.env.TELEGRAM_BOT_TOKEN,
      allowedUserId: parseInt(process.env.TELEGRAM_ALLOWED_USER_ID, 10),
      projectRoot: process.env.HOME || "/",
    };
  }

  return null;
}

const config = loadConfig();

if (!config) {
  console.error("CONFIG_NOT_FOUND");
  process.exit(1);
}

if (!config.token) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

if (!config.allowedUserId) {
  console.error("TELEGRAM_ALLOWED_USER_ID is required");
  process.exit(1);
}

const bot = createBot({
  token: config.token,
  allowedUserId: config.allowedUserId,
  projectRoot: config.projectRoot,
  streamMode: config.streamMode,
});

console.log("Starting Claude Telegram Bridge...");
console.log(`Allowed user: ${config.allowedUserId}`);
console.log(`Project root: ${config.projectRoot}`);

// Set up bot commands menu
bot.api.setMyCommands([
  { command: "start", description: "Welcome & help" },
  { command: "new", description: "Start new conversation" },
  { command: "stop", description: "Stop current task" },
  { command: "resume", description: "Resume previous session" },
  { command: "status", description: "Show current status" },
  { command: "cd", description: "Change directory" },
]).then(() => {
  bot.start({
    onStart: (botInfo) => {
      console.log(`Bot started: @${botInfo.username}`);
      console.log("Commands menu registered");
    },
  });
});
