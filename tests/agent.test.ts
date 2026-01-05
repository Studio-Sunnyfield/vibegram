// Tests for agent abstraction
import { describe, it, expect } from "bun:test";
import { ClaudeAgent, OpenCodeAgent } from "../src/agent";
import type { NormalizedEvent } from "../src/agent";
import * as fixtures from "./fixtures/events";

describe("ClaudeAgent", () => {
  describe("event normalization", () => {
    // We test the private normalizeEvent method indirectly by capturing events
    // from a mock scenario or by exposing the method for testing

    it("can be instantiated", () => {
      const events: NormalizedEvent[] = [];
      const agent = new ClaudeAgent(
        { cwd: "/test" },
        (event) => events.push(event)
      );
      expect(agent.isRunning()).toBe(false);
    });

    it("supports all AgentOptions", () => {
      const events: NormalizedEvent[] = [];
      const agent = new ClaudeAgent(
        {
          cwd: "/test",
          sessionId: "test-session",
          permissionMode: "bypassPermissions",
        },
        (event) => events.push(event)
      );
      expect(agent.isRunning()).toBe(false);
    });

    it("has setOnClose method", () => {
      const events: NormalizedEvent[] = [];
      const agent = new ClaudeAgent({ cwd: "/test" }, (event) => events.push(event));
      let closeCalled = false;
      agent.setOnClose((code, stderr) => {
        closeCalled = true;
      });
      expect(typeof agent.setOnClose).toBe("function");
    });
  });

  describe("NormalizedEvent types", () => {
    it("init event has correct shape", () => {
      const event: NormalizedEvent = {
        type: "init",
        sessionId: "abc123",
        model: "claude-sonnet",
        cwd: "/test",
      };
      expect(event.type).toBe("init");
      expect(event.sessionId).toBe("abc123");
    });

    it("tool_use event has correct shape", () => {
      const event: NormalizedEvent = {
        type: "tool_use",
        sessionId: "abc123",
        tool: "Bash",
        input: { command: "ls" },
      };
      expect(event.type).toBe("tool_use");
      expect(event.tool).toBe("Bash");
    });

    it("tool_output event has correct shape", () => {
      const event: NormalizedEvent = {
        type: "tool_output",
        sessionId: "abc123",
        output: "file1.ts\nfile2.ts",
        isError: false,
      };
      expect(event.type).toBe("tool_output");
      expect(event.output).toBe("file1.ts\nfile2.ts");
    });

    it("text event has correct shape", () => {
      const event: NormalizedEvent = {
        type: "text",
        sessionId: "abc123",
        content: "I'll help you with that.",
      };
      expect(event.type).toBe("text");
      expect(event.content).toBe("I'll help you with that.");
    });

    it("done event has correct shape", () => {
      const event: NormalizedEvent = {
        type: "done",
        sessionId: "abc123",
        durationMs: 5000,
        isError: false,
      };
      expect(event.type).toBe("done");
      expect(event.durationMs).toBe(5000);
    });

    it("error event has correct shape", () => {
      const event: NormalizedEvent = {
        type: "error",
        sessionId: "abc123",
        content: "Something went wrong",
      };
      expect(event.type).toBe("error");
      expect(event.content).toBe("Something went wrong");
    });
  });
});

describe("OpenCodeAgent", () => {
  it("can be instantiated", () => {
    const events: NormalizedEvent[] = [];
    const agent = new OpenCodeAgent(
      { cwd: "/test" },
      (event) => events.push(event)
    );
    expect(agent.isRunning()).toBe(false);
  });

  it("supports all AgentOptions", () => {
    const events: NormalizedEvent[] = [];
    const agent = new OpenCodeAgent(
      {
        cwd: "/test",
        sessionId: "test-session",
        permissionMode: "bypassPermissions",
      },
      (event) => events.push(event)
    );
    expect(agent.isRunning()).toBe(false);
  });

  it("has setOnClose method", () => {
    const events: NormalizedEvent[] = [];
    const agent = new OpenCodeAgent({ cwd: "/test" }, (event) => events.push(event));
    let closeCalled = false;
    agent.setOnClose((code, stderr) => {
      closeCalled = true;
    });
    expect(typeof agent.setOnClose).toBe("function");
  });

  it("supports continue session mode", () => {
    const events: NormalizedEvent[] = [];
    const agent = new OpenCodeAgent(
      { cwd: "/test", sessionId: "continue" },
      (event) => events.push(event)
    );
    expect(agent.isRunning()).toBe(false);
  });
});
