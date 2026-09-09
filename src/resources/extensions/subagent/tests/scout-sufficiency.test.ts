import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SubagentExecutionBackend } from "../execution/types.js";

const scout = readFileSync(new URL("../../../agents/scout.md", import.meta.url), "utf8");
const originalFrontmatter = "---\nname: scout\ndescription: Fast codebase recon that returns compressed context for handoff to other agents\ntools: read, grep, find, ls, bash\n---";

// These are prompt/loader contracts, not evidence that a model follows the prompt.
test("scout keeps its identity, permissions, depth, strategy and original handoff sections", () => {
	assert.equal(scout.slice(0, scout.indexOf("\n---", 4) + 4), originalFrontmatter);
	for (const line of [
		"- Quick: Targeted lookups, key files only",
		"- Medium: Follow imports, read critical sections",
		"- Thorough: Trace all dependencies, check tests/types",
		"1. grep/find to locate relevant code",
		"2. Read key sections (not entire files)",
		"3. Identify types, interfaces, key functions",
		"4. Note dependencies between files",
		"List with exact line ranges:",
	]) assert.ok(scout.includes(line), line);
	assert.deepEqual([...scout.matchAll(/^## (.+)$/gm)].map((match) => match[1]), [
		"Files Retrieved", "Key Code", "Architecture", "Start Here", "Evidence Sufficiency",
	]);
});

test("scout distinguishes evidence from inference and stops for specific reasons without quotas", () => {
	for (const text of [
		"facts confirmed by reading code/tests from inferences and unverified claims",
		"A filename in search results is a lead, not proof",
		"Hand off immediately when evidence is sufficient for the requested scope",
		"only to close a concrete gap",
		"Include tests, fixtures, and type definitions",
		"do not exclude them as a class",
		"Respect the given budget and chosen depth",
		"Do not fill file/iteration quotas",
		"re-read files without a specific unanswered question",
		"file:line evidence",
		"the implementation/verification decision it affects",
		"the next file, symbol, test, or external contract to check",
		"further exploration yielded no new evidence",
	]) assert.ok(scout.includes(text), text);
});

test("sufficiency is a short non-authoritative handoff and cannot conceal important gaps", () => {
	for (const text of [
		"sufficient_for_requested_scope", "gaps_remaining", "blocked",
		"Never mark sufficient with important gaps, even at the budget limit",
		"not correct code or completed work",
		"not an approval, failure, or retry gate",
		"the existing GSD flow decides what happens next",
		"do not edit source, install packages, spawn subagents, or declare the task complete",
		"refer to Files Retrieved / Key Code rather than repeating them",
		"Do not invent gaps or fill empty categories",
	]) assert.ok(scout.includes(text), text);
});

test("managed sync, user/project discovery and common runner preserve the complete scout prompt and handoff", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gsd-scout-sufficiency-"));
	const agentDir = join(root, "gsd-home", "agent");
	const project = join(root, "project");
	const bundle = join(root, "bundle");
	const envKeys = ["GSD_HOME", "PI_CODING_AGENT_DIR", "GSD_CODING_AGENT_DIR", "GSD_RESOURCE_FINGERPRINT_MODE"];
	const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
	process.env.GSD_HOME = join(root, "gsd-home");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.GSD_CODING_AGENT_DIR = agentDir;
	process.env.GSD_RESOURCE_FINGERPRINT_MODE = "live";
	t.after(() => {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(root, { recursive: true, force: true });
	});
	// Import only after private GSD_HOME is set: registry paths are module-scoped.
	const loader = await import("../../../../resource-loader.js");
	const { discoverAgents } = await import("../agents.js");
	const { __subagentLocalRunnerTestHooks: runner } = await import("../index.js");
	t.after(() => {
		loader.setBundledResourcesDirForTests(undefined);
		loader.setGsdBrowserPackageSkillPathForTests(undefined);
	});
	for (const dir of [project, join(bundle, "agents"), join(bundle, "extensions"), join(bundle, "shared")]) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(join(bundle, "agents", "scout.md"), scout);
	loader.setBundledResourcesDirForTests(bundle, root);
	loader.setGsdBrowserPackageSkillPathForTests(null);
	// Nondefault skillsDir deliberately skips the user's ~/.agents/skills cleanup.
	loader.initResources(agentDir, join(root, "private-skills"));
	assert.equal(readFileSync(join(agentDir, "agents", "scout.md"), "utf8"), scout);
	const userScout = discoverAgents(project, "user").agents.find((agent) => agent.name === "scout")!;
	assert.ok(userScout);
	assert.equal(userScout.source, "user");
	assert.equal(userScout.systemPrompt.trim(), scout.slice(originalFrontmatter.length).trim());
	assert.deepEqual(userScout.tools, ["read", "grep", "find", "ls", "bash"]);
	assert.equal(userScout.model, undefined);
	assert.equal(userScout.thinking, undefined);
	const projectAgents = join(project, ".gsd", "agents");
	mkdirSync(projectAgents, { recursive: true });
	writeFileSync(join(projectAgents, "scout.md"), scout);
	const projectScout = discoverAgents(project, "both").agents.find((agent) => agent.name === "scout")!;
	assert.equal(projectScout.source, "project");
	assert.equal(projectScout.filePath, join(projectAgents, "scout.md"));
	assert.equal(projectScout.systemPrompt, userScout.systemPrompt);
	assert.equal(discoverAgents(project, "project").agents[0].systemPrompt, userScout.systemPrompt);

	// No process/model runs here. The existing injectable backend observes the real
	// launch artifact and relays synthetic text through the unchanged semantic parser.
	for (const status of ["sufficient_for_requested_scope", "gaps_remaining", "blocked"]) {
		const handoff = `## Files Retrieved\nsource.ts:1-2\n## Evidence Sufficiency\nStatus: ${status}`;
		let promptPath = "";
		const backend: SubagentExecutionBackend = {
			id: "scout-test", isAvailable: () => true,
			async execute(request, callbacks) {
				promptPath = request.launch.args[request.launch.args.indexOf("--append-system-prompt") + 1];
				assert.equal(readFileSync(promptPath, "utf8"), projectScout.systemPrompt);
				assert.equal(request.launch.args[request.launch.args.indexOf("--model") + 1], "fixture-role-model");
				assert.equal(request.launch.args[request.launch.args.indexOf("--thinking") + 1], "medium");
				callbacks.onStdoutLine(JSON.stringify({ type: "message_end", message: {
					role: "assistant", content: [{ type: "text", text: handoff }], stopReason: "stop",
				} }));
				return { exitCode: 0, aborted: false };
			},
		};
		const result = await runner.runSingleAgentWithBackend(
			project, [projectScout], "scout", "Inspect the requested contract", undefined, undefined,
			undefined, undefined, (results) => ({ mode: "single", agentScope: "project", projectAgentsDir: projectAgents, results }),
			{ contextMode: "fresh", modelOverride: "fixture-role-model", thinkingOverride: "medium" }, backend,
		);
		assert.equal(result.exitCode, 0, "handoff status does not become an execution gate");
		assert.deepEqual(result.messages[0].content, [{ type: "text", text: handoff }]);
		assert.equal(existsSync(promptPath), false, "existing runner cleans up its prompt artifact");
		assert.equal(projectScout.model, undefined, "role override does not mutate the loaded agent");
	}
});
