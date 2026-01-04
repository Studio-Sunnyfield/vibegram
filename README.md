# Vibegram

Control [Claude Code](https://claude.ai/claude-code) from Telegram. Voice-first mobile coding.

<img src="docs/screenshot.png" width="300" alt="Vibegram screenshot">

## What is this?

Vibegram is a macOS menu bar app that bridges Telegram to Claude Code CLI. Send voice messages or text from your phone, and Claude Code executes on your machine.

**Use cases:**
- Code from your phone while walking
- Voice-first coding with Telegram's speech-to-text
- Quick fixes without opening your laptop
- Mobile pair programming with Claude

## Prerequisites

1. **Claude Code CLI** - Install from [claude.ai/claude-code](https://claude.ai/claude-code)
2. **Telegram Bot Token** - Create a bot via [@BotFather](https://t.me/botfather)
3. **Your Telegram User ID** - Get it from [@userinfobot](https://t.me/userinfobot)

## Installation

### Download (Recommended)

1. Download the latest `.dmg` from [Releases](https://github.com/Studio-Sunnyfield/vibegram/releases)
2. Drag `Vibegram.app` to Applications
3. Right-click → Open (required for unsigned apps)
4. Configure your bot token and user ID in Settings

### Build from Source

```bash
# Clone
git clone https://github.com/Studio-Sunnyfield/vibegram.git
cd vibegram

# Install dependencies
npm install
cd app && npm install && cd ..

# Build
npm run build

# App is at app/dist/mac-universal/Vibegram.app
```

## Usage

### Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/new` | Start fresh conversation |
| `/stop` | Stop current task |
| `/resume` | Continue previous session |
| `/status` | Show current status |
| `/cd <path>` | Change working directory |

### Features

- **Voice messages** - Telegram transcribes, Claude executes
- **Images** - Send screenshots for Claude to analyze
- **Session persistence** - Resume where you left off
- **Live status** - See what Claude is doing in real-time

### Status Indicators

The menu bar shows:
- `🤓` Bot is running
- `😴` Bot is stopped

In chat:
- `💭 Thinking...` - Processing your request
- `🔧 Running command` - Executing a tool
- `💭 Responding...` - Generating response
- `✅ Done` - Task complete

## Environment Variable

When Claude Code runs via Vibegram, it sets:

```bash
VIBEGRAM_SOURCE=telegram
```

Use this in [Claude Code hooks](https://claude.ai/claude-code/hooks) to customize behavior for Telegram messages.

## Security

- **Single user only** - Only your Telegram user ID can interact with the bot
- **Local execution** - Claude Code runs on your machine, not in the cloud
- **No data collection** - Your conversations stay between you and Claude

## Troubleshooting

**App won't open:**
- Right-click → Open (macOS Gatekeeper blocks unsigned apps)

**Bot won't start:**
- Verify your bot token with [@BotFather](https://t.me/botfather)
- Check your user ID with [@userinfobot](https://t.me/userinfobot)
- Ensure Claude Code CLI is installed: `claude --version`

**Commands not working:**
- Make sure the bot is running (🤓 in menu bar)
- Check the project directory exists

## License

MIT - see [LICENSE](LICENSE)

---

Made by [Studio Sunnyfield](https://sunnyfield.studio)
