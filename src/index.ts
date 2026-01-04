import { createBot } from "./bot";
import { file } from "bun";

// Load .env file explicitly (overrides system env)
const envFile = await file(".env").text();
const envVars: Record<string, string> = {};
for (const line of envFile.split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) {
    envVars[key.trim()] = rest.join("=").trim();
  }
}

const token = envVars.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const allowedUserId = envVars.TELEGRAM_ALLOWED_USER_ID || process.env.TELEGRAM_ALLOWED_USER_ID;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

if (!allowedUserId) {
  console.error("TELEGRAM_ALLOWED_USER_ID is required");
  process.exit(1);
}

const bot = createBot({
  token,
  allowedUserId: parseInt(allowedUserId, 10),
});

console.log("Starting Claude Telegram Bridge...");
console.log(`Allowed user: ${allowedUserId}`);

// Set up bot commands menu
await bot.api.setMyCommands([
  { command: "start", description: "Welcome & help" },
  { command: "new", description: "Start new conversation" },
  { command: "stop", description: "Stop current task" },
  { command: "resume", description: "Resume previous session" },
  { command: "status", description: "Show current status" },
  { command: "cd", description: "Change directory" },
]);

bot.start({
  onStart: (botInfo) => {
    console.log(`Bot started: @${botInfo.username}`);
    console.log("Commands menu registered");
  },
});
