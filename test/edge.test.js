import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyVisit, clusterIntents } from "../src/classify.js";
test("edge: UA matching is case-insensitive", () => assert.equal(classifyVisit({ ua: "mozilla/5.0 (compatible; gptbot/1.2)" }).kind, "ai_agent"));
test("edge: ClaudeBot is an AI agent", () => assert.equal(classifyVisit({ ua: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" }).kind, "ai_agent"));
test("edge: missing ua field does not throw", () => assert.doesNotThrow(() => classifyVisit({})));
test("edge: clustering empty list", () => assert.doesNotThrow(() => clusterIntents([])));
