// Project/App: gsd-pi
// File Purpose: Pin PLAN task-description bytes without indent-only blank lines.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { renderPlanFromDb } from "../markdown-renderer.ts";
import { openDatabase, closeDatabase, insertMilestone, insertSlice, insertTask } from "../gsd-db.ts";

const cases = [
  {
    name: "empty paragraph breaks stay empty",
    description: "First paragraph.\n\nSecond paragraph.",
    expected: "  First paragraph.\n\n  Second paragraph.",
  },
  {
    name: "space, tab and CRLF blank lines stay empty",
    description: "First paragraph.\r\n   \n\t \n\r\nSecond paragraph.",
    expected: "  First paragraph.\r\n\n\n\n  Second paragraph.",
  },
  {
    name: "nonempty description indentation and trailing content stay unchanged",
    description: "First paragraph.\n  - Nested item  \n\tcode();\nLast paragraph.",
    expected: "  First paragraph.\n    - Nested item  \n  \tcode();\n  Last paragraph.",
  },
];

for (const fixture of cases) {
  test(`PLAN task description bytes: ${fixture.name}`, async (t) => {
    const base = mkdtempSync(join(tmpdir(), "gsd-renderer-whitespace-"));
    t.after(() => {
      try {
        closeDatabase();
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    });
    mkdirSync(join(base, ".gsd"), { recursive: true });
    openDatabase(join(base, ".gsd", "gsd.db"));
    insertMilestone({ id: "M001", title: "Foundation", status: "active" });
    insertSlice({
      milestoneId: "M001", id: "S01", title: "Set up tooling", status: "pending",
      risk: "low", depends: [], demo: "build runs", sequence: 1,
    });
    insertTask({
      milestoneId: "M001", sliceId: "S01", id: "T01", title: "Init repo",
      status: "pending", sequence: 1,
      planning: { description: fixture.description },
    });

    const result = await renderPlanFromDb(base, "M001", "S01");
    const taskBlock = result.content.match(/<tasks>\n[\s\S]*?<\/tasks>/)?.[0];
    assert.equal(typeof taskBlock, "string", "the rendered plan contains its task block");
    const expectedBlock = `<tasks>\n- [ ] **T01**: Init repo\n${fixture.expected}\n</tasks>`;
    assert.deepEqual(Buffer.from(taskBlock!), Buffer.from(expectedBlock));
    assert.deepEqual(readFileSync(result.planPath), Buffer.from(result.content), "on-disk projection matches rendered bytes");
    assert.deepEqual(result.content.split("\n").filter((line) => /^\s+$/.test(line)), [], "blank lines never contain indentation");
  });
}
