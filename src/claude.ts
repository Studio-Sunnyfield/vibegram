import type { Subprocess, FileSink } from "bun";
import type { ClaudeEvent } from "./types";

export interface ClaudeProcessOptions {
  cwd: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  sessionId?: string;
  allowedTools?: string[];
}

export type EventCallback = (event: ClaudeEvent) => void | Promise<void>;

type ClaudeSubprocess = Subprocess<"pipe", "pipe", "pipe">;

export class ClaudeProcess {
  private proc: ClaudeSubprocess | null = null;
  private buffer = "";
  private onEvent: EventCallback;
  private options: ClaudeProcessOptions;

  constructor(options: ClaudeProcessOptions, onEvent: EventCallback) {
    this.options = options;
    this.onEvent = onEvent;
  }

  async start(initialPrompt: string): Promise<void> {
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

    this.proc = Bun.spawn(["claude", ...args], {
      cwd: this.options.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }) as ClaudeSubprocess;

    // Start reading stdout
    this.readStream();

    // Send initial prompt
    await this.sendMessage(initialPrompt);
  }

  private async readStream(): Promise<void> {
    if (!this.proc) return;

    const stdout = this.proc.stdout as ReadableStream<Uint8Array>;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.buffer += decoder.decode(value, { stream: true });

        // Process complete JSON lines
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line) as ClaudeEvent;
              await this.onEvent(event);
            } catch (e) {
              console.error("Failed to parse JSON:", line, e);
            }
          }
        }
      }
    } catch (e) {
      console.error("Stream read error:", e);
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.proc) {
      throw new Error("Process not started");
    }

    const message = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    });

    const stdin = this.proc.stdin as FileSink;
    stdin.write(message + "\n");
    stdin.flush();
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
