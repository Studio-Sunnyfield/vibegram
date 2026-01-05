import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import type {
  CodingAgent,
  AgentOptions,
  EventCallback,
  CloseCallback,
  NormalizedEvent,
} from "./types";
import type {
  ClaudeEvent,
  AssistantEvent,
  UserEvent,
  ResultEvent,
  SystemInitEvent,
  ToolUseContent,
  TextContent,
} from "../types";

interface ImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

interface MessageTextContent {
  type: "text";
  text: string;
}

type MessageContent = MessageTextContent | ImageContent;

export class ClaudeAgent implements CodingAgent {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private stderrBuffer = "";
  private onEvent: EventCallback;
  private onCloseCallback?: CloseCallback;
  private options: AgentOptions;

  constructor(options: AgentOptions, onEvent: EventCallback) {
    this.options = options;
    this.onEvent = onEvent;
  }

  setOnClose(callback: CloseCallback): void {
    this.onCloseCallback = callback;
  }

  async start(prompt: string, imagePath?: string): Promise<void> {
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    if (this.options.permissionMode) {
      args.push("--permission-mode", this.options.permissionMode);
    }

    if (this.options.sessionId === "continue") {
      args.push("--continue");
    } else if (this.options.sessionId) {
      args.push("--resume", this.options.sessionId);
    }

    this.proc = spawn("claude", args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        VIBEGRAM_SOURCE: "telegram",
      },
    });

    this.proc.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line) as ClaudeEvent;
            this.handleClaudeEvent(event);
          } catch (e) {
            console.error("Failed to parse JSON:", line, e);
          }
        }
      }
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      console.error("[claude stderr]", text);
      this.stderrBuffer += text;
    });

    this.proc.on("close", (code) => {
      console.log(`Claude process exited with code ${code}`);
      this.proc = null;
      if (this.onCloseCallback) {
        this.onCloseCallback(code, this.stderrBuffer);
      }
    });

    await this.sendMessage(prompt, imagePath);
  }

  private handleClaudeEvent(event: ClaudeEvent): void {
    const normalized = this.normalizeEvent(event);
    if (normalized) {
      this.onEvent(normalized);
    }
  }

  private normalizeEvent(event: ClaudeEvent): NormalizedEvent | null {
    switch (event.type) {
      case "system": {
        const sysEvent = event as SystemInitEvent;
        if (sysEvent.subtype === "init") {
          return {
            type: "init",
            sessionId: sysEvent.session_id,
            model: sysEvent.model,
            cwd: sysEvent.cwd,
          };
        }
        return null;
      }

      case "assistant": {
        const assistantEvent = event as AssistantEvent;
        const events: NormalizedEvent[] = [];

        for (const content of assistantEvent.message.content) {
          if (content.type === "tool_use") {
            const toolContent = content as ToolUseContent;
            return {
              type: "tool_use",
              sessionId: assistantEvent.session_id,
              tool: toolContent.name,
              input: toolContent.input,
            };
          } else if (content.type === "text") {
            const textContent = content as TextContent;
            if (textContent.text.trim()) {
              return {
                type: "text",
                sessionId: assistantEvent.session_id,
                content: textContent.text,
              };
            }
          }
        }
        return null;
      }

      case "user": {
        const userEvent = event as UserEvent;
        if (userEvent.tool_use_result) {
          const output =
            userEvent.tool_use_result.stdout || userEvent.tool_use_result.stderr;
          if (output?.trim()) {
            return {
              type: "tool_output",
              sessionId: userEvent.session_id,
              output: output.trim(),
              isError: !!userEvent.tool_use_result.stderr,
            };
          }
        }
        return null;
      }

      case "result": {
        const resultEvent = event as ResultEvent;
        return {
          type: "done",
          sessionId: resultEvent.session_id,
          durationMs: resultEvent.duration_ms,
          isError: resultEvent.is_error,
          content: resultEvent.is_error ? resultEvent.result : undefined,
        };
      }

      default:
        return null;
    }
  }

  async sendMessage(text: string, imagePath?: string): Promise<void> {
    if (!this.proc || !this.proc.stdin) {
      throw new Error("Process not started");
    }

    const content: MessageContent[] = [];

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
