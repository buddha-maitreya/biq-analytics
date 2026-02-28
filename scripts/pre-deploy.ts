/**
 * pre-deploy.ts — Comprehensive pre-deployment validation
 *
 * Catches every class of error that could cause a cloud build failure,
 * providing clear diagnostics LOCALLY before wasting time on deploy cycles.
 *
 * Usage:
 *   bun scripts/pre-deploy.ts          # Full validation
 *   bun run validate                   # Same via npm script
 *
 * Checks performed:
 *   1. TypeScript type checking (tsc --noEmit --skipLibCheck)
 *   2. No .md file imports in source code
 *   3. Agent file structure validation (index.ts exists and exports correctly)
 *   4. Required dependencies installed
 *   5. agentuity.json valid
 *   6. Full build test (uses Windows path-fix wrapper on Windows)
 *
 * Exit codes:
 *   0 — All checks passed, safe to deploy
 *   1 — One or more checks failed (details printed)
 */

import { resolve, join, relative } from "node:path";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const SRC = join(ROOT, "src");
const AGENT_DIR = join(SRC, "agent");

interface CheckResult {
	name: string;
	passed: boolean;
	errors: string[];
	warnings: string[];
	duration: number;
}

const results: CheckResult[] = [];
let totalErrors = 0;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function banner(text: string) {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`  ${text}`);
	console.log("=".repeat(60));
}

function getAllSourceFiles(dir: string, extensions = [".ts", ".tsx", ".js", ".jsx"]): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;

	function walk(d: string) {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const fullPath = join(d, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === ".agentuity" || entry.name === "dist") continue;
				walk(fullPath);
			} else if (extensions.some((ext) => entry.name.endsWith(ext))) {
				files.push(fullPath);
			}
		}
	}
	walk(dir);
	return files;
}

// ---------------------------------------------------------------------------
// Check 1: No dotted files in src/web/public/ (Agentuity CLI bug guard)
// ---------------------------------------------------------------------------

async function checkNoDottedPublicFiles(): Promise<CheckResult> {
	const start = Date.now();
	const errors: string[] = [];
	const warnings: string[] = [];

	console.log("\n[1/7] Checking for dotted files in src/web/public/...");

	const publicDir = join(SRC, "web", "public");
	if (existsSync(publicDir)) {
		const entries = readdirSync(publicDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.includes(".")) {
				errors.push(
					`src/web/public/${entry.name} — files with dots in src/web/public/ break the Agentuity CLI route type generator. ` +
					`The CLI generates unquoted property names (e.g. \`manifest.json:\`) which is invalid TypeScript. ` +
					`Move this file's content to a .ts constant in src/lib/ and serve via an app.ts route instead. ` +
					`See src/lib/pwa-assets.ts for the pattern.`
				);
			}
		}
	}

	const passed = errors.length === 0;
	console.log(passed ? "  ✓ No dotted files in src/web/public/" : `  ✗ ${errors.length} dotted file(s) found — these WILL break deployment`);
	return { name: "No dotted public files", passed, errors, warnings, duration: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Check 2: TypeScript type checking
// ---------------------------------------------------------------------------

async function checkTypeScript(): Promise<CheckResult> {
	const start = Date.now();
	const errors: string[] = [];
	const warnings: string[] = [];

	console.log("\n[2/7] TypeScript type checking...");

	const proc = Bun.spawn(["bunx", "tsc", "--noEmit", "--skipLibCheck", "--pretty", "false"], {
		cwd: ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		const output = (stdout + "\n" + stderr).trim();
		const lines = output.split("\n").filter((l) => l.trim());
		// Parse TypeScript error lines
		for (const line of lines) {
			if (line.includes("error TS")) {
				errors.push(line.trim());
			}
		}
		if (errors.length === 0 && output) {
			errors.push(`tsc exited with code ${exitCode}: ${output.slice(0, 500)}`);
		}
	}

	const passed = errors.length === 0;
	console.log(passed ? "  ✓ No TypeScript errors" : `  ✗ ${errors.length} TypeScript error(s)`);
	return { name: "TypeScript", passed, errors, warnings, duration: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Check 2: No .md imports in source code
// ---------------------------------------------------------------------------

async function checkNoMarkdownImports(): Promise<CheckResult> {
	const start = Date.now();
	const errors: string[] = [];
	const warnings: string[] = [];

	console.log("\n[3/7] Checking for .md file imports...");

	const sourceFiles = getAllSourceFiles(SRC);
	const mdImportPattern = /(?:import|require)\s*\(?\s*['"`]([^'"`]*\.md)['"`]\s*\)?/g;

	for (const file of sourceFiles) {
		const content = readFileSync(file, "utf-8");
		let match: RegExpExecArray | null;
		while ((match = mdImportPattern.exec(content)) !== null) {
			const relPath = relative(ROOT, file).replace(/\\/g, "/");
			errors.push(`${relPath}: imports "${match[1]}" — .md files must never be imported in source code`);
		}
	}

	const passed = errors.length === 0;
	console.log(passed ? "  ✓ No .md imports found" : `  ✗ ${errors.length} .md import(s) found`);
	return { name: "No .md imports", passed, errors, warnings, duration: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Check 3: Agent file structure
// ---------------------------------------------------------------------------

async function checkAgentStructure(): Promise<CheckResult> {
	const start = Date.now();
	const errors: string[] = [];
	const warnings: string[] = [];

	console.log("\n[4/7] Validating agent file structure...");

	if (!existsSync(AGENT_DIR)) {
		errors.push("src/agent/ directory does not exist");
		return { name: "Agent structure", passed: false, errors, warnings, duration: Date.now() - start };
	}

	const agentDirs = readdirSync(AGENT_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);

	if (agentDirs.length === 0) {
		warnings.push("No agent directories found in src/agent/");
	}

	for (const agentName of agentDirs) {
		const indexPath = join(AGENT_DIR, agentName, "index.ts");
		if (!existsSync(indexPath)) {
			errors.push(`src/agent/${agentName}/index.ts does not exist — agents must have an index.ts file`);
			continue;
		}

		// Validate that the file exports something (basic check)
		const content = readFileSync(indexPath, "utf-8");
		if (!content.includes("export default") && !content.includes("export =")) {
			errors.push(`src/agent/${agentName}/index.ts: no default export found — agents must use \`export default createAgent(...)\``);
		}

		if (!content.includes("createAgent")) {
			warnings.push(`src/agent/${agentName}/index.ts: does not contain 'createAgent' — verify it's a valid agent`);
		}
	}

	const passed = errors.length === 0;
	console.log(passed ? `  ✓ ${agentDirs.length} agent(s) validated` : `  ✗ ${errors.length} agent structure error(s)`);
	return { name: "Agent structure", passed, errors, warnings, duration: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Check 4: Dependencies installed
// ---------------------------------------------------------------------------

async function checkDependencies(): Promise<CheckResult> {
	const start = Date.now();
	const errors: string[] = [];
	const warnings: string[] = [];

	console.log("\n[5/7] Checking dependencies...");

	const nodeModules = join(ROOT, "node_modules");
	if (!existsSync(nodeModules)) {
		errors.push("node_modules/ not found — run `bun install` first");
		return { name: "Dependencies", passed: false, errors, warnings, duration: Date.now() - start };
	}

	// Check critical dependencies
	const criticalDeps = [
		"@agentuity/runtime",
		"@agentuity/drizzle",
		"@agentuity/react",
		"@agentuity/schema",
		"drizzle-orm",
		"zod",
		"ai",
		"react",
		"react-dom",
	];

	for (const dep of criticalDeps) {
		const depPath = join(nodeModules, ...dep.split("/"));
		if (!existsSync(depPath)) {
			errors.push(`Missing dependency: ${dep} — run \`bun install\``);
		}
	}

	// Check for drizzle-orm duplication
	const drizzleOrmPath = join(nodeModules, "drizzle-orm", "package.json");
	if (existsSync(drizzleOrmPath)) {
		const pkg = JSON.parse(readFileSync(drizzleOrmPath, "utf-8"));
		if (pkg.version && !pkg.version.startsWith("0.45")) {
			warnings.push(`drizzle-orm version ${pkg.version} — expected 0.45.x. Run \`bun install\` to update.`);
		}
	}

	const passed = errors.length === 0;
	console.log(passed ? `  ✓ All ${criticalDeps.length} critical dependencies present` : `  ✗ ${errors.length} dependency error(s)`);
	return { name: "Dependencies", passed, errors, warnings, duration: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Check 5: agentuity.json valid
// ---------------------------------------------------------------------------

async function checkAgentuityConfig(): Promise<CheckResult> {
	const start = Date.now();
	const errors: string[] = [];
	const warnings: string[] = [];

	console.log("\n[6/7] Validating agentuity.json...");

	const configPath = join(ROOT, "agentuity.json");
	if (!existsSync(configPath)) {
		errors.push("agentuity.json not found — run `agentuity project create` or create manually");
		return { name: "agentuity.json", passed: false, errors, warnings, duration: Date.now() - start };
	}

	try {
		const config = JSON.parse(readFileSync(configPath, "utf-8"));

		if (!config.projectId) errors.push("agentuity.json: missing 'projectId'");
		if (!config.orgId) errors.push("agentuity.json: missing 'orgId'");
		if (!config.region) warnings.push("agentuity.json: missing 'region' — will use default");

		if (config.projectId && !/^proj_[a-f0-9]+$/.test(config.projectId)) {
			warnings.push(`agentuity.json: projectId '${config.projectId}' has unexpected format`);
		}
		if (config.orgId && !/^org_[a-zA-Z0-9]+$/.test(config.orgId)) {
			warnings.push(`agentuity.json: orgId '${config.orgId}' has unexpected format`);
		}
	} catch (e) {
		errors.push(`agentuity.json: invalid JSON — ${e instanceof Error ? e.message : String(e)}`);
	}

	const passed = errors.length === 0;
	console.log(passed ? "  ✓ agentuity.json is valid" : `  ✗ ${errors.length} config error(s)`);
	return { name: "agentuity.json", passed, errors, warnings, duration: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Check 6: Full build test
// ---------------------------------------------------------------------------

async function checkBuild(): Promise<CheckResult> {
	const start = Date.now();
	const errors: string[] = [];
	const warnings: string[] = [];

	console.log("\n[7/7] Running full build test...");

	// On Windows, use the build wrapper (scripts/build.ts) which has a file watcher
	// that fixes backslash paths in real-time as the CLI generates files.
	// On Linux/macOS, use agentuity build directly — no path issues.
	const isWindows = process.platform === "win32";
	const cmd = isWindows
		? ["bun", join(ROOT, "scripts", "build.ts")]
		: ["agentuity", "build", "--skip-type-check"];

	if (isWindows) {
		console.log("  → Windows detected — using build wrapper with path-fix watcher");
	}

	const proc = Bun.spawn(cmd, {
		cwd: ROOT,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		const output = (stdout + "\n" + stderr).trim();
		if (output) {
			errors.push(`Build failed (exit code ${exitCode}):\n${output.slice(0, 2000)}`);
		} else {
			errors.push(`Build failed with exit code ${exitCode} — no output captured`);
		}
	}

	const passed = errors.length === 0;
	console.log(passed ? "  ✓ Build succeeded" : "  ✗ Build failed");
	return { name: "Build", passed, errors, warnings, duration: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	banner("PRE-DEPLOY VALIDATION");
	console.log(`Project: ${ROOT}`);
	console.log(`Platform: ${process.platform}`);
	console.log(`Bun: ${Bun.version}`);
	console.log(`Time: ${new Date().toISOString()}`);

	// Run all checks
	const checks = [
		checkNoDottedPublicFiles,
		checkTypeScript,
		checkNoMarkdownImports,
		checkAgentStructure,
		checkDependencies,
		checkAgentuityConfig,
		checkBuild,
	];

	for (const check of checks) {
		try {
			const result = await check();
			results.push(result);
			totalErrors += result.errors.length;
		} catch (e) {
			const name = check.name.replace("check", "");
			results.push({
				name,
				passed: false,
				errors: [`Unexpected error: ${e instanceof Error ? e.message : String(e)}`],
				warnings: [],
				duration: 0,
			});
			totalErrors++;
		}
	}

	// Print summary
	banner("VALIDATION SUMMARY");

	const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
	const passedChecks = results.filter((r) => r.passed).length;
	const failedChecks = results.filter((r) => !r.passed).length;

	for (const result of results) {
		const status = result.passed ? "✓ PASS" : "✗ FAIL";
		console.log(`  ${status}  ${result.name} (${result.duration}ms)`);

		for (const err of result.errors) {
			console.log(`         ERROR: ${err}`);
		}
		for (const warn of result.warnings) {
			console.log(`         WARN:  ${warn}`);
		}
	}

	console.log(`\n  ${passedChecks} passed, ${failedChecks} failed, ${totalWarnings} warning(s)`);
	console.log(`  Total time: ${results.reduce((sum, r) => sum + r.duration, 0)}ms`);

	if (failedChecks > 0) {
		console.log("\n  ✗ DEPLOYMENT NOT SAFE — fix the errors above before deploying.\n");
		process.exit(1);
	} else {
		console.log("\n  ✓ ALL CHECKS PASSED — safe to deploy.\n");
		process.exit(0);
	}
}

await main();
