import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { DefaultPackageManager } from "./package-manager.js";
import { SettingsManager } from "./settings-manager.js";
import { formatSkillsForPrompt, loadSkills } from "./skills.js";

test("nested .agents markdown skills are discovered and assessment gates stay out of the model catalog", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-nested-skills-"));
	const cwd = path.join(root, "work");
	const agentDir = path.join(root, "agent");
	const skillsDir = path.join(root, ".agents", "skills");
	const rootMarkdown = path.join(skillsDir, "notes.md");
	const nestedGate = path.join(skillsDir, "vendor", "review.md");
	fs.mkdirSync(path.dirname(nestedGate), { recursive: true });
	fs.mkdirSync(cwd, { recursive: true });
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(rootMarkdown, "---\nname: notes\ndescription: not a root skill\n---\n");
	fs.writeFileSync(
		nestedGate,
		[
			"---",
			"name: nested-review",
			"description: Nested report-only review",
			"gsd:",
			"  kind: assessment-gate",
			"  invocation: manual",
			"  lifecycle: [post-validation]",
			"  effect: report-only",
			"  revisionBinding: required",
			"  resultSchema: gsd.findings/v1",
			"  capabilities: [repository.read]",
			"---",
			"Gate body must remain isolated.",
		].join("\n"),
	);

	try {
		const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: SettingsManager.inMemory() });
		const resolved = await manager.resolve();
		assert.equal(resolved.skills.some((resource) => resource.path === rootMarkdown), false);
		assert.equal(resolved.skills.some((resource) => resource.path === nestedGate && resource.enabled), true);

		const loaded = loadSkills({
			cwd,
			agentDir,
			skillPaths: resolved.skills.filter((resource) => resource.enabled).map((resource) => resource.path),
			includeDefaults: false,
		});
		const gate = loaded.skills.find((skill) => skill.name === "nested-review");
		assert.equal(gate?.gsd?.kind, "assessment-gate");
		assert.equal(gate?.disableModelInvocation, true);
		assert.equal(formatSkillsForPrompt(loaded.skills).includes("Gate body must remain isolated."), false);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
