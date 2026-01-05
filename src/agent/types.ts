// Abstract coding agent interface
// Allows swapping Claude Code, OpenCode, Aider, etc.

export interface AgentOptions {
  cwd: string;
  sessionId?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}

// Normalized event types that all agents emit
export interface AgentEvent {
  type: "init" | "thinking" | "tool_use" | "tool_output" | "text" | "error" | "done";
  sessionId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface InitEvent extends AgentEvent {
  type: "init";
  sessionId: string;
  model?: string;
  cwd?: string;
}

export interface ThinkingEvent extends AgentEvent {
  type: "thinking";
}

export interface ToolUseEvent extends AgentEvent {
  type: "tool_use";
  tool: string;
  input?: Record<string, unknown>;
}

export interface ToolOutputEvent extends AgentEvent {
  type: "tool_output";
  output: string;
  isError?: boolean;
}

export interface TextEvent extends AgentEvent {
  type: "text";
  content: string;
}

export interface ErrorEvent extends AgentEvent {
  type: "error";
  content: string;
}

export interface DoneEvent extends AgentEvent {
  type: "done";
  durationMs?: number;
  isError?: boolean;
}

export type NormalizedEvent =
  | InitEvent
  | ThinkingEvent
  | ToolUseEvent
  | ToolOutputEvent
  | TextEvent
  | ErrorEvent
  | DoneEvent;

export type EventCallback = (event: NormalizedEvent) => void | Promise<void>;
export type CloseCallback = (code: number | null, stderr: string) => void | Promise<void>;

// Abstract agent interface
export interface CodingAgent {
  start(prompt: string, imagePath?: string): Promise<void>;
  sendMessage(text: string, imagePath?: string): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  setOnClose(callback: CloseCallback): void;
}
