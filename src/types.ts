// Claude CLI streaming JSON event types

export interface SystemInitEvent {
  type: "system";
  subtype: "init";
  cwd: string;
  session_id: string;
  tools: string[];
  model: string;
  permissionMode: string;
}

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface AssistantEvent {
  type: "assistant";
  message: {
    model: string;
    id: string;
    role: "assistant";
    content: (ToolUseContent | TextContent)[];
    stop_reason: string | null;
  };
  session_id: string;
}

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export interface UserEvent {
  type: "user";
  message: {
    role: "user";
    content: (ToolResultContent | { type: "text"; text: string })[];
  };
  session_id: string;
  tool_use_result?: {
    stdout: string;
    stderr: string;
    interrupted: boolean;
  };
}

export interface ResultEvent {
  type: "result";
  subtype: "success" | "error";
  is_error: boolean;
  duration_ms: number;
  result: string;
  session_id: string;
  total_cost_usd: number;
}

export type ClaudeEvent =
  | SystemInitEvent
  | AssistantEvent
  | UserEvent
  | ResultEvent
  | { type: string; [key: string]: unknown }; // fallback for unknown events

// Session state
export interface Session {
  sessionId: string | null;
  cwd: string;
  isProcessing: boolean;
  statusMessageId: number | null;
}
