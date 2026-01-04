// Test fixtures for Claude CLI events
// These represent real event shapes from the Claude CLI

import type {
  SystemInitEvent,
  AssistantEvent,
  UserEvent,
  ResultEvent,
  ToolUseContent,
  TextContent,
} from "../../src/types";

export const systemInitEvent: SystemInitEvent = {
  type: "system",
  subtype: "init",
  cwd: "/Users/test/project",
  session_id: "abc123-def456",
  tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
  model: "claude-sonnet-4-20250514",
  permissionMode: "bypassPermissions",
};

export const textAssistantEvent: AssistantEvent = {
  type: "assistant",
  message: {
    model: "claude-sonnet-4-20250514",
    id: "msg_123",
    role: "assistant",
    content: [
      {
        type: "text",
        text: "I'll help you with that task.",
      },
    ],
    stop_reason: null,
  },
  session_id: "abc123-def456",
};

export const toolUseAssistantEvent: AssistantEvent = {
  type: "assistant",
  message: {
    model: "claude-sonnet-4-20250514",
    id: "msg_456",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "tool_123",
        name: "Bash",
        input: { command: "ls -la" },
      },
    ],
    stop_reason: null,
  },
  session_id: "abc123-def456",
};

export const userToolResultEvent: UserEvent = {
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "tool_123",
        content: "total 0\ndrwxr-xr-x  3 user  staff  96 Jan  1 00:00 .",
        is_error: false,
      },
    ],
  },
  session_id: "abc123-def456",
  tool_use_result: {
    stdout: "total 0\ndrwxr-xr-x  3 user  staff  96 Jan  1 00:00 .",
    stderr: "",
    interrupted: false,
  },
};

export const successResultEvent: ResultEvent = {
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 5432,
  result: "Task completed successfully",
  session_id: "abc123-def456",
  total_cost_usd: 0.0123,
};

export const errorResultEvent: ResultEvent = {
  type: "result",
  subtype: "error",
  is_error: true,
  duration_ms: 1234,
  result: "Command failed with exit code 1",
  session_id: "abc123-def456",
  total_cost_usd: 0.005,
};

// Tool use content samples for formatToolUse tests
export const bashToolUse: ToolUseContent = {
  type: "tool_use",
  id: "tool_1",
  name: "Bash",
  input: { command: "npm install" },
};

export const readToolUse: ToolUseContent = {
  type: "tool_use",
  id: "tool_2",
  name: "Read",
  input: { file_path: "/src/index.ts" },
};

export const editToolUse: ToolUseContent = {
  type: "tool_use",
  id: "tool_3",
  name: "Edit",
  input: { file_path: "/src/bot.ts", old_string: "foo", new_string: "bar" },
};

export const writeToolUse: ToolUseContent = {
  type: "tool_use",
  id: "tool_4",
  name: "Write",
  input: { file_path: "/src/new.ts", content: "// new file" },
};

export const globToolUse: ToolUseContent = {
  type: "tool_use",
  id: "tool_5",
  name: "Glob",
  input: { pattern: "**/*.ts" },
};

export const grepToolUse: ToolUseContent = {
  type: "tool_use",
  id: "tool_6",
  name: "Grep",
  input: { pattern: "function.*test" },
};

export const taskToolUse: ToolUseContent = {
  type: "tool_use",
  id: "tool_7",
  name: "Task",
  input: { description: "Explore codebase" },
};
