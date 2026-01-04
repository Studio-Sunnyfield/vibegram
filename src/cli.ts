#!/usr/bin/env node
// CLI interface for Claude bridge (Article II: CLI Interface Mandate)
// Allows testing the Claude process independently

import { ClaudeProcess, type ClaudeProcessOptions } from "./claude";
import { formatToolUse, stripThinkingTags } from "./utils";
import type { ClaudeEvent, AssistantEvent, UserEvent, ResultEvent, SystemInitEvent, ToolUseContent, TextContent } from "./types";

const args = process.argv.slice(2);

function printUsage(): void {
  console.log(`
Usage: vibegram-cli [options] <prompt>

Options:
  --cwd <path>        Working directory (default: current directory)
  --continue          Continue most recent session
  --session <id>      Resume specific session
  --json              Output raw JSON events
  --quiet             Only output final result
  -h, --help          Show this help

Examples:
  vibegram-cli "list files in current directory"
  vibegram-cli --cwd ~/project "explain the codebase"
  vibegram-cli --continue "what were we working on?"
  vibegram-cli --json "hello" | jq '.type'
`);
}

// Parse arguments
let cwd = process.cwd();
let sessionId: string | undefined;
let jsonOutput = false;
let quiet = false;
let prompt = "";

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case "-h":
    case "--help":
      printUsage();
      process.exit(0);
    case "--cwd":
      cwd = args[++i];
      break;
    case "--continue":
      sessionId = "continue";
      break;
    case "--session":
      sessionId = args[++i];
      break;
    case "--json":
      jsonOutput = true;
      break;
    case "--quiet":
      quiet = true;
      break;
    default:
      if (!arg.startsWith("-")) {
        prompt = arg;
      }
  }
}

if (!prompt) {
  // Read from stdin if no prompt provided
  const chunks: Buffer[] = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    prompt = Buffer.concat(chunks).toString().trim();
    if (!prompt) {
      printUsage();
      process.exit(1);
    }
    run();
  });
} else {
  run();
}

async function run(): Promise<void> {
  const options: ClaudeProcessOptions = {
    cwd,
    permissionMode: "bypassPermissions",
    sessionId,
  };

  const handleEvent = (event: ClaudeEvent): void => {
    if (jsonOutput) {
      console.log(JSON.stringify(event));
      return;
    }

    switch (event.type) {
      case "system": {
        const sysEvent = event as SystemInitEvent;
        if (sysEvent.subtype === "init" && !quiet) {
          console.log(`[session: ${sysEvent.session_id.slice(0, 8)}... | cwd: ${sysEvent.cwd}]`);
        }
        break;
      }

      case "assistant": {
        const assistantEvent = event as AssistantEvent;
        for (const content of assistantEvent.message.content) {
          if (content.type === "tool_use") {
            const toolContent = content as ToolUseContent;
            if (!quiet) {
              console.log(`[tool] ${formatToolUse(toolContent)}`);
            }
          } else if (content.type === "text") {
            const textContent = content as TextContent;
            const text = stripThinkingTags(textContent.text);
            if (text) {
              console.log(text);
            }
          }
        }
        break;
      }

      case "user": {
        const userEvent = event as UserEvent;
        if (userEvent.tool_use_result && !quiet) {
          const { stdout, stderr } = userEvent.tool_use_result;
          if (stdout) console.log(`[stdout] ${stdout.slice(0, 200)}${stdout.length > 200 ? "..." : ""}`);
          if (stderr) console.log(`[stderr] ${stderr.slice(0, 200)}${stderr.length > 200 ? "..." : ""}`);
        }
        break;
      }

      case "result": {
        const resultEvent = event as ResultEvent;
        if (!quiet) {
          console.log(`\n[${resultEvent.is_error ? "error" : "done"}] ${resultEvent.duration_ms}ms | $${resultEvent.total_cost_usd.toFixed(4)}`);
        }
        if (resultEvent.is_error) {
          console.error(resultEvent.result);
          process.exit(1);
        }
        process.exit(0);
        break;
      }
    }
  };

  const claude = new ClaudeProcess(options, handleEvent);

  // Handle Ctrl+C
  process.on("SIGINT", async () => {
    console.log("\n[interrupted]");
    await claude.stop();
    process.exit(130);
  });

  try {
    await claude.start(prompt);
  } catch (e) {
    console.error(`Error: ${e}`);
    process.exit(1);
  }
}
