import { createBot } from "./bot-node";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Config directory
const configDir = path.join(os.homedir(), "Library", "Application Support", "Vibegram");
const configPath = path.join(configDir, "config.json");

// Ensure config dir exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Load config
interface Config {
  token: string;
  allowedUserId: number;
  projectRoot: string;
}

function loadConfig(): Config | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
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
