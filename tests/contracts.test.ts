// Contract tests for Claude CLI event types
// These validate that our type definitions match the actual CLI output

import { describe, it, expect } from "bun:test";
import type { ClaudeEvent } from "../src/types";
import * as fixtures from "./fixtures/events";

describe("Claude Event Contracts", () => {
  describe("SystemInitEvent", () => {
    it("has required fields", () => {
      const event = fixtures.systemInitEvent;
      expect(event.type).toBe("system");
      expect(event.subtype).toBe("init");
      expect(typeof event.cwd).toBe("string");
      expect(typeof event.session_id).toBe("string");
      expect(Array.isArray(event.tools)).toBe(true);
      expect(typeof event.model).toBe("string");
      expect(typeof event.permissionMode).toBe("string");
    });

    it("session_id format is valid", () => {
      const event = fixtures.systemInitEvent;
      expect(event.session_id.length).toBeGreaterThan(0);
    });
  });

  describe("AssistantEvent", () => {
    it("text content has required fields", () => {
      const event = fixtures.textAssistantEvent;
      expect(event.type).toBe("assistant");
      expect(event.message.role).toBe("assistant");
      expect(Array.isArray(event.message.content)).toBe(true);

      const textContent = event.message.content[0];
      expect(textContent.type).toBe("text");
      if (textContent.type === "text") {
        expect(typeof textContent.text).toBe("string");
      }
    });

    it("tool_use content has required fields", () => {
      const event = fixtures.toolUseAssistantEvent;
      const toolContent = event.message.content[0];
      expect(toolContent.type).toBe("tool_use");
      if (toolContent.type === "tool_use") {
        expect(typeof toolContent.id).toBe("string");
        expect(typeof toolContent.name).toBe("string");
        expect(typeof toolContent.input).toBe("object");
      }
    });
  });

  describe("UserEvent", () => {
    it("tool_result has required fields", () => {
      const event = fixtures.userToolResultEvent;
      expect(event.type).toBe("user");
      expect(event.message.role).toBe("user");

      const resultContent = event.message.content[0];
      expect(resultContent.type).toBe("tool_result");
      if (resultContent.type === "tool_result") {
        expect(typeof resultContent.tool_use_id).toBe("string");
        expect(typeof resultContent.content).toBe("string");
        expect(typeof resultContent.is_error).toBe("boolean");
      }
    });

    it("tool_use_result is optional but has correct shape when present", () => {
      const event = fixtures.userToolResultEvent;
      expect(event.tool_use_result).toBeDefined();
      if (event.tool_use_result) {
        expect(typeof event.tool_use_result.stdout).toBe("string");
        expect(typeof event.tool_use_result.stderr).toBe("string");
        expect(typeof event.tool_use_result.interrupted).toBe("boolean");
      }
    });
  });

  describe("ResultEvent", () => {
    it("success result has required fields", () => {
      const event = fixtures.successResultEvent;
      expect(event.type).toBe("result");
      expect(event.subtype).toBe("success");
      expect(event.is_error).toBe(false);
      expect(typeof event.duration_ms).toBe("number");
      expect(typeof event.result).toBe("string");
      expect(typeof event.session_id).toBe("string");
      expect(typeof event.total_cost_usd).toBe("number");
    });

    it("error result has is_error true", () => {
      const event = fixtures.errorResultEvent;
      expect(event.type).toBe("result");
      expect(event.subtype).toBe("error");
      expect(event.is_error).toBe(true);
    });
  });

  describe("ClaudeEvent union type", () => {
    it("all fixture events are valid ClaudeEvents", () => {
      const events: ClaudeEvent[] = [
        fixtures.systemInitEvent,
        fixtures.textAssistantEvent,
        fixtures.toolUseAssistantEvent,
        fixtures.userToolResultEvent,
        fixtures.successResultEvent,
        fixtures.errorResultEvent,
      ];

      for (const event of events) {
        expect(event.type).toBeDefined();
        expect(typeof event.type).toBe("string");
      }
    });
  });
});
