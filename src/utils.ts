// Utility functions extracted for testability
import type { ToolUseContent } from "./types";

/**
 * Format a tool use event for display in Telegram
 */
export function formatToolUse(tool: ToolUseContent): string {
  const name = tool.name;
  const input = tool.input;

  switch (name) {
    case "Bash":
      const cmd = (input as { command?: string }).command || "";
      const shortCmd = cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
      return `\`${shortCmd}\``;
    case "Read":
      return `Reading \`${(input as { file_path?: string }).file_path}\``;
    case "Edit":
      return `Editing \`${(input as { file_path?: string }).file_path}\``;
    case "Write":
      return `Writing \`${(input as { file_path?: string }).file_path}\``;
    case "Glob":
      return `Searching \`${(input as { pattern?: string }).pattern}\``;
    case "Grep":
      return `Grepping \`${(input as { pattern?: string }).pattern}\``;
    case "Task":
      return `Running task...`;
    default:
      return name;
  }
}

/**
 * Strip thinking tags from assistant responses
 */
export function stripThinkingTags(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim();
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

/**
 * Resolve a path, handling ~ and relative paths
 */
export function resolvePath(inputPath: string, cwd: string, home: string): string {
  let path = inputPath;

  if (path.startsWith("~")) {
    path = path.replace("~", home);
  }

  if (!path.startsWith("/")) {
    path = `${cwd}/${path}`;
  }

  // Normalize path (resolve ..)
  const parts = path.split("/").filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }

  return "/" + resolved.join("/");
}
