import assert from "node:assert/strict";
import test from "node:test";
import { describeHerdrInteractiveInput } from "../interactive-input.js";

test("question input presentation is privacy-bounded and counts questions", () => {
  const descriptor = describeHerdrInteractiveInput("ask_user_questions", {
    questions: [
      { header: "Secret", question: "Use token sk-private?", options: [{ label: "Yes" }] },
      { header: "Deploy", question: "Ship now?", options: [{ label: "No" }] },
    ],
  });

  assert.equal(descriptor?.waitingMessage, "awaiting user input · 2 questions");
  assert.equal(descriptor?.settledMessage, "user input settled");
  assert.doesNotMatch(JSON.stringify(descriptor), /sk-private|Ship now|Secret|Deploy/);
});

test("MCP-scoped question tools and secure input use canonical attention states", () => {
  assert.equal(
    describeHerdrInteractiveInput("mcp__workflow__ask_user_questions", { questions: [{}] })?.waitingMessage,
    "awaiting user input · 1 question",
  );
  assert.equal(
    describeHerdrInteractiveInput("mcp__secrets__secure_env_collect")?.waitingMessage,
    "secure input required",
  );
  assert.equal(describeHerdrInteractiveInput("bash"), undefined);
});
