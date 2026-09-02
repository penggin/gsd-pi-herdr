import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadExtensions } from "./loader.js";

test("importing the extension loader does not eagerly load the Jiti Babel transform", () => {
	const loaderPath = fileURLToPath(new URL("./loader.js", import.meta.url));
	const script = `
		import { createRequire } from "node:module";
		await import(${JSON.stringify(pathToFileURL(loaderPath).href)});
		const require = createRequire(import.meta.url);
		const loadedBabel = Object.keys(require.cache).some(
			(path) => path.includes("jiti") && path.endsWith("babel.cjs"),
		);
		process.stdout.write(String(loadedBabel));
	`;
	const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
		encoding: "utf8",
	});

	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "false");
});

test("the deferred Node importer still transforms TypeScript extensions", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lazy-jiti-"));
	const extensionPath = path.join(cwd, "typed-extension.ts");
	fs.writeFileSync(
		extensionPath,
		`export default function (pi: { registerCommand: Function }) {
			pi.registerCommand("lazy-jiti-probe", { handler() {} });
		}`,
	);

	try {
		const result = await loadExtensions([extensionPath], cwd);
		assert.deepEqual(result.errors, []);
		assert.equal(result.extensions.length, 1);
		assert.equal(result.extensions[0]?.commands.has("lazy-jiti-probe"), true);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
