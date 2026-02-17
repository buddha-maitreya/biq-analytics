/**
 * fix-generated-paths.ts
 *
 * Normalizes Windows backslash paths in auto-generated files under src/generated/.
 *
 * WHY THIS EXISTS:
 * The Agentuity CLI generates TypeScript files with platform-native path separators.
 * On Windows, this produces import paths like:
 *   '..\..\node_modules\@agentuity\runtime/src/index'
 *
 * In JavaScript string literals, this creates escape sequences:
 *   \n → newline,  \r → carriage return,  \t → tab
 * These silently corrupt the import paths and break compilation.
 *
 * This script scans all .ts files in src/generated/ and replaces backslashes
 * with forward slashes in import/export path specifiers.
 *
 * USAGE:
 *   bun scripts/fix-generated-paths.ts          # standalone
 *   import { fixGeneratedPaths } from './fix-generated-paths'  # programmatic
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const GENERATED_DIR = resolve(import.meta.dirname ?? ".", "..", "src", "generated");

// ---------------------------------------------------------------------------
// Core fix function
// ---------------------------------------------------------------------------

/**
 * Replace backslashes with forward slashes inside string-literal import paths,
 * and fix bare 'src/...' specifiers in generated files under src/generated/.
 *
 * Only modifies paths that actually need fixing — leaves clean
 * package-name imports (e.g. '@agentuity/runtime') untouched.
 */
export function normalizeImportPaths(source: string): string {
	// 1. Fix backslash paths → forward slashes
	let result = source.replace(
		/((?:from|import|export|require)\s*\(?['"])((?:[^'"]*\\[^'"]*)+)(['"])/g,
		(_match, prefix: string, importPath: string, suffix: string) => {
			return prefix + importPath.replace(/\\/g, "/") + suffix;
		},
	);

	// 2. Fix bare 'src/agent/...' specifiers → relative '../agent/...'
	//    Generated registry.ts lives at src/generated/registry.ts,
	//    so 'src/agent/X' should be '../agent/X'.
	result = result.replace(
		/((?:from|import)\s*['"])src\/(agent\/[^'"]+)(['"])/g,
		(_match, prefix: string, rest: string, suffix: string) => {
			return `${prefix}../${rest}${suffix}`;
		},
	);

	return result;
}

// ---------------------------------------------------------------------------
// File-level helpers
// ---------------------------------------------------------------------------

/**
 * Fix a single file. Returns true if the file was modified.
 */
export async function fixFile(filePath: string): Promise<boolean> {
	const content = await readFile(filePath, "utf-8");
	const fixed = normalizeImportPaths(content);
	if (content !== fixed) {
		await writeFile(filePath, fixed, "utf-8");
		return true;
	}
	return false;
}

/**
 * Fix every .ts / .js file in src/generated/.
 * Returns the list of files that were modified.
 */
export async function fixGeneratedPaths(
	dir: string = GENERATED_DIR,
): Promise<string[]> {
	const modified: string[] = [];
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		// Directory may not exist yet on a fresh clone
		return modified;
	}

	for (const entry of entries) {
		if (!/\.(ts|js|mts|mjs)$/.test(entry)) continue;
		const fullPath = join(dir, entry);
		if (await fixFile(fullPath)) {
			modified.push(entry);
		}
	}
	return modified;
}

// ---------------------------------------------------------------------------
// CLI entry point — run directly with `bun scripts/fix-generated-paths.ts`
// ---------------------------------------------------------------------------

const isDirectRun =
	process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/fix-generated-paths.ts") ||
	process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/fix-generated-paths");

if (isDirectRun) {
	const modified = await fixGeneratedPaths();
	if (modified.length > 0) {
		console.log(`Fixed Windows paths in ${modified.length} generated file(s):`);
		for (const f of modified) console.log(`  src/generated/${f}`);
	} else {
		console.log("All generated files have correct paths — nothing to fix.");
	}
}
