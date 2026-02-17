/**
 * build.ts — Windows-safe build wrapper for Agentuity
 *
 * Problem:
 *   `agentuity build` generates src/generated/*.ts files, then compiles them.
 *   On Windows, generated import paths use backslashes, creating broken escape
 *   sequences (\n = newline, \r = carriage return) that corrupt imports.
 *   There are no build hooks in AgentuityConfig to intercept between
 *   generation and compilation.
 *
 * Solution:
 *   This wrapper watches src/generated/ for file writes during the build.
 *   As soon as a file is written, it normalizes backslash paths to forward
 *   slashes — intercepting between the generation and compilation phases.
 *   If the build still fails (race condition), it fixes all paths and retries.
 *
 * Usage:
 *   bun scripts/build.ts           # replaces `agentuity build`
 *   bun scripts/build.ts --deploy  # build + deploy
 */

import { watch, type FSWatcher } from "node:fs";
import { resolve, join } from "node:path";
import { fixFile, fixGeneratedPaths } from "./fix-generated-paths";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const GENERATED_DIR = join(ROOT, "src", "generated");
const isWindows = process.platform === "win32";

// Pass-through flags (e.g. --deploy)
const extraArgs = process.argv.slice(2);

// Always skip the CLI's built-in type checker — it has a PEG parser bug
// on some tsconfig formats. We run `tsc --noEmit` ourselves after a successful build.
const buildArgs = ["build", "--skip-type-check", ...extraArgs];

// ---------------------------------------------------------------------------
// File watcher — fixes paths in real-time as the CLI writes generated files
// ---------------------------------------------------------------------------

function startWatcher(): FSWatcher | null {
	if (!isWindows) return null; // Only needed on Windows

	try {
		const watcher = watch(GENERATED_DIR, { recursive: false }, (_event, filename) => {
			if (!filename || !/\.(ts|js|mts|mjs)$/.test(filename)) return;
			const filePath = join(GENERATED_DIR, filename);
			// Fire-and-forget — best-effort real-time fix
			fixFile(filePath).catch(() => {});
		});
		return watcher;
	} catch {
		// Directory may not exist yet — that's fine, build will create it
		return null;
	}
}

// ---------------------------------------------------------------------------
// Build runner
// ---------------------------------------------------------------------------

async function runBuild(): Promise<number> {
	const proc = Bun.spawn(["agentuity", ...buildArgs], {
		cwd: ROOT,
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env },
	});
	return proc.exited;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	if (!isWindows) {
		// On Linux/macOS, just run the build directly — no path issues
		const code = await runBuild();
		process.exit(code);
	}

	console.log("[build] Windows detected — watching src/generated/ for path fixes");

	// Phase 1: Start watcher, then run build
	const watcher = startWatcher();
	let exitCode = await runBuild();
	watcher?.close();

	if (exitCode === 0) {
		console.log("[build] Build succeeded on first pass.");
		process.exit(0);
	}

	// Phase 2: Build failed — fix any remaining bad paths and retry
	console.log("[build] Build failed — fixing generated paths and retrying...");
	const modified = await fixGeneratedPaths(GENERATED_DIR);

	if (modified.length === 0) {
		// Paths were already clean — failure is something else
		console.error("[build] No path issues found in generated files. Build failure is unrelated to Windows paths.");
		process.exit(exitCode);
	}

	console.log(`[build] Fixed ${modified.length} file(s): ${modified.join(", ")}`);
	console.log("[build] Retrying build with watcher active...");

	// Phase 3: Retry with watcher active for the regeneration
	const watcher2 = startWatcher();
	exitCode = await runBuild();
	watcher2?.close();

	if (exitCode === 0) {
		console.log("[build] Build succeeded on retry.");
	} else {
		// Last resort: fix paths one more time after the retry's generation
		const modified2 = await fixGeneratedPaths(GENERATED_DIR);
		if (modified2.length > 0) {
			console.log(`[build] Fixed ${modified2.length} more file(s) after retry generation.`);
			console.log("[build] Running final build attempt...");
			const watcher3 = startWatcher();
			exitCode = await runBuild();
			watcher3?.close();
		}
	}

	process.exit(exitCode);
}

await main();
