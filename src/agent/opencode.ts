import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import type {
  CodingAgent,
  AgentOptions,
  EventCallback,
  CloseCallback,
  NormalizedEvent,
} from "./types";

// OpenCode JSON event types (from --format json)
interface OpenCodeEvent {
  type: string;
  timestamp: number;
  sessionID: string;
  part?: OpenCodePart;
  error?: {
    name: string;
    data?: { message?: string };
  };
}

interface OpenCodePart {
  type: string;
  sessionID: string;
  tool?: string;
  text?: string;
  state?: {
    status?: string;
    title?: string;
    input?: Record<string, unknown>;
    output?: string;
  };
  time?: {
    start?: number;
    end?: number;
  };
}

export class OpenCodeAgent implements CodingAgent {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private stderrBuffer = "";
  private onEvent: EventCallback;
  private onCloseCallback?: CloseCallback;
  private options: AgentOptions;
  private sessionId: string | null = null;

  constructor(options: AgentOptions, onEvent: EventCallback) {
    this.options = options;
    this.onEvent = onEvent;
    // If resuming, set the session ID
    if (options.sessionId && options.sessionId !== "continue") {
      this.sessionId = options.sessionId;
    }
  }

  setOnClose(callback: CloseCallback): void {
    this.onCloseCallback = callback;
  }

  async start(prompt: string, imagePath?: string): Promise<void> {
    await this.runCommand(prompt, imagePath);
  }

  private async runCommand(prompt: string, imagePath?: string): Promise<void> {
    const args = ["run", "--format", "json"];

    // Session handling
    if (this.options.sessionId === "continue") {
      args.push("--continue");
    } else if (this.sessionId) {
      args.push("--session", this.sessionId);
    }

    // Attach image if provided
    if (imagePath && fs.existsSync(imagePath)) {
      args.push("--file", imagePath);
    }

    // Add the prompt
    args.push(prompt);

    this.proc = spawn("opencode", args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        VIBEGRAM_SOURCE: "telegram",
      },
    });

    this.buffer = "";
    this.stderrBuffer = "";

    this.proc.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line) as OpenCodeEvent;
            this.handleOpenCodeEvent(event);
          } catch (e) {
            console.error("Failed to parse OpenCode JSON:", line, e);
          }
        }
      }
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      console.error("[opencode stderr]", text);
      this.stderrBuffer += text;
    });

    this.proc.on("close", (code) => {
      console.log(`OpenCode process exited with code ${code}`);
      this.proc = null;

      // Fire done event when process completes
      this.onEvent({
        type: "done",
        sessionId: this.sessionId || undefined,
        isError: code !== 0,
      });

      if (this.onCloseCallback) {
        this.onCloseCallback(code, this.stderrBuffer);
      }
    });
  }

  private handleOpenCodeEvent(event: OpenCodeEvent): void {
    // Capture session ID from first event
    if (event.sessionID && !this.sessionId) {
      this.sessionId = event.sessionID;
      this.onEvent({
        type: "init",
        sessionId: event.sessionID,
      });
    }

    const normalized = this.normalizeEvent(event);
    if (normalized) {
      this.onEvent(normalized);
    }
  }

  private normalizeEvent(event: OpenCodeEvent): NormalizedEvent | null {
    switch (event.type) {
      case "tool_use": {
        const part = event.part;
        if (!part) return null;
        return {
          type: "tool_use",
          sessionId: event.sessionID,
          tool: part.tool || "Unknown",
          input: part.state?.input || {},
        };
      }

      case "text": {
        const part = event.part;
        if (!part || !part.text) return null;
        return {
          type: "text",
          sessionId: event.sessionID,
          content: part.text,
        };
      }

      case "error": {
        let errorMsg = event.error?.name || "Unknown error";
        if (event.error?.data?.message) {
          errorMsg = event.error.data.message;
        }
        return {
          type: "error",
          sessionId: event.sessionID,
          content: errorMsg,
        };
      }

      case "step_start":
        // Could emit a thinking event, but opencode doesn't have great visibility here
        return null;

      case "step_finish":
        // Step completed, but not the full task
        return null;

      default:
        return null;
    }
  }

  async sendMessage(text: string, imagePath?: string): Promise<void> {
    // OpenCode doesn't support interactive stdin like Claude
    // We need to spawn a new process with --session to continue
    if (this.proc && this.proc.exitCode === null) {
      // If still running, wait for it to finish
      await new Promise<void>((resolve) => {
        this.proc?.on("close", () => resolve());
      });
    }

    // Run a new command with the same session
    await this.runCommand(text, imagePath);
  }

  async stop(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }
}
