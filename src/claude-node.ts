import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import type { ClaudeEvent } from "./types";

export interface ClaudeProcessOptions {
  cwd: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  sessionId?: string;
  allowedTools?: string[];
}

export type EventCallback = (event: ClaudeEvent) => void | Promise<void>;

interface ImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

interface TextContent {
  type: "text";
  text: string;
}

type MessageContent = TextContent | ImageContent;

export class ClaudeProcess {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private onEvent: EventCallback;
  private options: ClaudeProcessOptions;

  constructor(options: ClaudeProcessOptions, onEvent: EventCallback) {
    this.options = options;
    this.onEvent = onEvent;
  }

  async start(initialPrompt: string, imagePath?: string): Promise<void> {
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    // Permission mode
    if (this.options.permissionMode) {
      args.push("--permission-mode", this.options.permissionMode);
    }

    // Continue most recent session
    if (this.options.sessionId === "continue") {
      args.push("--continue");
    } else if (this.options.sessionId) {
      args.push("--resume", this.options.sessionId);
    }

    // Allowed tools
    if (this.options.allowedTools?.length) {
      args.push("--allowedTools", this.options.allowedTools.join(","));
    }

    this.proc = spawn("claude", args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        VIBEGRAM_SOURCE: "telegram", // Indicator for hooks to detect Telegram messages
      },
    });

    // Handle stdout
    this.proc.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();

      // Process complete JSON lines
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line) as ClaudeEvent;
            this.onEvent(event);
          } catch (e) {
            console.error("Failed to parse JSON:", line, e);
          }
        }
      }
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      console.error("[claude stderr]", data.toString());
    });

    this.proc.on("close", (code) => {
      console.log(`Claude process exited with code ${code}`);
      this.proc = null;
    });

    // Send initial prompt with optional image
    await this.sendMessage(initialPrompt, imagePath);
  }

  async sendMessage(text: string, imagePath?: string): Promise<void> {
    if (!this.proc || !this.proc.stdin) {
      throw new Error("Process not started");
    }

    const content: MessageContent[] = [];

    // Add image if provided
    if (imagePath && fs.existsSync(imagePath)) {
      const imageData = fs.readFileSync(imagePath);
      const base64 = imageData.toString("base64");
      const ext = imagePath.split(".").pop()?.toLowerCase() || "jpg";
      const mediaType = ext === "png" ? "image/png" : "image/jpeg";

      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64,
        },
      });
    }

    // Add text
    content.push({ type: "text", text });

    const message = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content,
      },
    });

    this.proc.stdin.write(message + "\n");
  }

  async stop(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  isRunning(): boolean {
    return this.proc !== null;
  }
}
