// Unit tests for utility functions
import { describe, it, expect } from "bun:test";
import { formatToolUse, stripThinkingTags, truncate, resolvePath } from "../src/utils";
import * as fixtures from "./fixtures/events";

describe("formatToolUse", () => {
  it("formats Bash command", () => {
    const result = formatToolUse(fixtures.bashToolUse);
    expect(result).toBe("`npm install`");
  });

  it("truncates long Bash commands", () => {
    const longCommand = {
      ...fixtures.bashToolUse,
      input: { command: "a".repeat(100) },
    };
    const result = formatToolUse(longCommand);
    expect(result).toBe("`" + "a".repeat(50) + "...`");
  });

  it("formats Read tool", () => {
    const result = formatToolUse(fixtures.readToolUse);
    expect(result).toBe("Reading `/src/index.ts`");
  });

  it("formats Edit tool", () => {
    const result = formatToolUse(fixtures.editToolUse);
    expect(result).toBe("Editing `/src/bot.ts`");
  });

  it("formats Write tool", () => {
    const result = formatToolUse(fixtures.writeToolUse);
    expect(result).toBe("Writing `/src/new.ts`");
  });

  it("formats Glob tool", () => {
    const result = formatToolUse(fixtures.globToolUse);
    expect(result).toBe("Searching `**/*.ts`");
  });

  it("formats Grep tool", () => {
    const result = formatToolUse(fixtures.grepToolUse);
    expect(result).toBe("Grepping `function.*test`");
  });

  it("formats Task tool", () => {
    const result = formatToolUse(fixtures.taskToolUse);
    expect(result).toBe("Running task...");
  });

  it("returns tool name for unknown tools", () => {
    const unknownTool = {
      type: "tool_use" as const,
      id: "tool_x",
      name: "UnknownTool",
      input: {},
    };
    const result = formatToolUse(unknownTool);
    expect(result).toBe("UnknownTool");
  });
});

describe("stripThinkingTags", () => {
  it("removes thinking tags", () => {
    const input = "<thinking>internal thought</thinking>Visible response";
    const result = stripThinkingTags(input);
    expect(result).toBe("Visible response");
  });

  it("handles multiline thinking tags", () => {
    const input = `<thinking>
    Line 1
    Line 2
    </thinking>Response here`;
    const result = stripThinkingTags(input);
    expect(result).toBe("Response here");
  });

  it("handles multiple thinking tags", () => {
    const input = "<thinking>first</thinking>Middle<thinking>second</thinking>End";
    const result = stripThinkingTags(input);
    expect(result).toBe("MiddleEnd");
  });

  it("returns original if no thinking tags", () => {
    const input = "Just a normal response";
    const result = stripThinkingTags(input);
    expect(result).toBe("Just a normal response");
  });

  it("trims whitespace", () => {
    const input = "  <thinking>thought</thinking>  Response  ";
    const result = stripThinkingTags(input);
    expect(result).toBe("Response");
  });
});

describe("truncate", () => {
  it("returns original if under max length", () => {
    const result = truncate("short", 10);
    expect(result).toBe("short");
  });

  it("truncates and adds ellipsis", () => {
    const result = truncate("this is a long string", 10);
    expect(result).toBe("this is a ...");
  });

  it("handles exact length", () => {
    const result = truncate("exact", 5);
    expect(result).toBe("exact");
  });
});

describe("resolvePath", () => {
  const cwd = "/Users/test/project";
  const home = "/Users/test";

  it("expands ~ to home directory", () => {
    const result = resolvePath("~/documents", cwd, home);
    expect(result).toBe("/Users/test/documents");
  });

  it("resolves relative paths from cwd", () => {
    const result = resolvePath("src/index.ts", cwd, home);
    expect(result).toBe("/Users/test/project/src/index.ts");
  });

  it("keeps absolute paths unchanged", () => {
    const result = resolvePath("/absolute/path", cwd, home);
    expect(result).toBe("/absolute/path");
  });

  it("resolves .. in paths", () => {
    const result = resolvePath("../other", cwd, home);
    expect(result).toBe("/Users/test/other");
  });

  it("resolves multiple .. in paths", () => {
    const result = resolvePath("../../sibling", cwd, home);
    expect(result).toBe("/Users/sibling");
  });

  it("handles . in paths", () => {
    const result = resolvePath("./src", cwd, home);
    expect(result).toBe("/Users/test/project/src");
  });

  it("handles complex paths", () => {
    const result = resolvePath("~/projects/../documents/./file.txt", cwd, home);
    expect(result).toBe("/Users/test/documents/file.txt");
  });
});
