#!/usr/bin/env node

import {execSync} from "child_process";
import * as fs from "fs";
import * as path from "path";

interface BuildFileConfig {
    name: string;
    deps: Array<string>;
    testDeps: Array<string>;
    visibilityRaw?: string;
    testonly?: boolean;
}

interface ImportInfo {
    relativePath: string;
    bazelTarget: string;
    isNodeModule: boolean;
}

const helpText = `Update BUILD file dependencies for directories

Usage:
    dev experimental generate-build-file <dir>           Update BUILD file for specific directory
    dev experimental generate-build-file <dir1> <dir2>   Update BUILD files for multiple directories
    dev experimental generate-build-file --diff          Update BUILD files for all changed directories
    dev experimental generate-build-file --create <dir>  Create new BUILD file for directory

Examples:
    dev experimental generate-build-file client/tasks
    dev experimental generate-build-file --diff
    dev experimental generate-build-file --create shared/new_module`;

// Global cache mapping file paths to their exact Bazel targets
let fileToTargetCache: Map<string, string> | null = null;

/**
 * Finds the closing bracket followed by a comma (end of visibility array)
 */
function findMatchingClosingBracket(content: string, startPos: number): number {
    let depth = 0;
    for (let i = startPos; i < content.length; i++) {
        const char = content[i];
        if (char === "[") {
            depth++;
        } else if (char === "]") {
            depth--;
            if (depth === 0) {
                // Found the closing bracket, now check if it's followed by a comma
                // Skip whitespace to find the comma
                let j = i + 1;
                while (j < content.length && /\s/.test(content[j]!)) {
                    j++;
                }
                if (j < content.length && content[j] === ",") {
                    return i;
                }
                // If no comma, this might not be the right closing bracket
                // Continue looking for another one (though this is rare)
            }
        }
    }
    return -1;
}

/**
 * Builds a comprehensive mapping of all TypeScript files to their exact Bazel targets
 * using bazel query to get accurate information directly from Bazel
 */
function buildFileToTargetCache(): Map<string, string> {
    if (fileToTargetCache) {
        return fileToTargetCache;
    }

    fileToTargetCache = new Map<string, string>();

    try {
        // Get all ts_project targets using bazel query
        // eslint-disable-next-line cyberworlds/string-quotes, no-useless-escape
        const tsProjectTargetsOutput = execSync(`bazel query 'kind(\"ts_project rule\", //...)'`, {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
        });

        const targets = tsProjectTargetsOutput
            .split("\n")
            .map((line: string) => line.trim())
            .filter((line: string) => line.length > 0);

        // For each target, get its source files
        for (const target of targets) {
            try {
                // eslint-disable-next-line cyberworlds/string-quotes
                const sourceFilesOutput = execSync(`bazel query "labels(srcs, ${target})"`, {
                    encoding: "utf-8",
                    stdio: ["ignore", "pipe", "ignore"],
                });

                const sourceFiles = sourceFilesOutput
                    .split("\n")
                    .map((line: string) => line.trim())
                    .filter((line: string) => line.length > 0);

                // Map each source file to this target
                for (const sourceFile of sourceFiles) {
                    // Convert from bazel label format (//package:file.ts) to relative path (package/file.ts)
                    const relativePath = sourceFile.replace(/^\/\//, "").replace(":", "/");
                    fileToTargetCache.set(relativePath, target);
                }
            } catch (error) {
                // Skip targets we can't query (might be external or broken)
                // eslint-disable-next-line no-console
                console.warn(
                    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                    `Warning: Could not query source files for target ${target}: ${error}`,
                );
            }
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error querying bazel targets:", error);
        throw error;
    }

    return fileToTargetCache;
}

/**
 * Gets the exact Bazel target for a file using the comprehensive cache
 */
/**
 * Simplifies a Bazel target by omitting the target name if it matches the directory name
 * E.g., "//shared/design:design" becomes "//shared/design"
 * But "//shared/design:design_core" remains "//shared/design:design_core"
 */
function simplifyBazelTarget(target: string): string {
    const colonIndex = target.lastIndexOf(":");
    if (colonIndex === -1) {
        return target; // No target part, return as-is
    }

    const packagePart = target.substring(0, colonIndex);
    const targetPart = target.substring(colonIndex + 1);

    // Get the directory name from the package part
    const lastSlashIndex = packagePart.lastIndexOf("/");
    const dirName = lastSlashIndex >= 0 ? packagePart.substring(lastSlashIndex + 1) : packagePart;

    // If target name matches directory name, omit the target
    if (targetPart === dirName) {
        return packagePart;
    }

    return target; // Keep original if target name differs from directory name
}

function getBazelTargetForFile(filePath: string): string | null {
    const cache = buildFileToTargetCache();
    const rawTarget = cache.get(filePath);
    if (!rawTarget) {
        return null;
    }
    return simplifyBazelTarget(rawTarget);
}

// Node.js built-in modules that should not be mapped to npm packages
const NODE_BUILTIN_MODULES = new Set([
    "assert",
    "buffer",
    "child_process",
    "cluster",
    "crypto",
    "dgram",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "https",
    "net",
    "os",
    "path",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "string_decoder",
    "tls",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "zlib",
    "constants",
    "module",
    "process",
    "timers",
    "console",
    "inspector",
    "async_hooks",
    "http2",
    "perf_hooks",
    "trace_events",
    "worker_threads",
    "wasi",
]);

/**
 * Converts a relative import path to a Bazel target
 */
function convertImportToBazelTarget(importPath: string, currentDir: string): ImportInfo | null {
    // Handle special # prefixed imports (internal module resolution)
    if (importPath.startsWith("#")) {
        // Skip # prefixed imports as they're likely internal module resolution
        return null;
    }

    // Handle node_modules imports (includes npm packages AND Node.js built-ins)
    if (!importPath.startsWith(".") && !importPath.startsWith("~")) {
        // Skip node: prefixed imports as they're handled by Node.js runtime
        if (importPath.startsWith("node:")) {
            return null;
        }

        // Extract the package name (handle scoped packages like @lezer/common)
        let packageName: string;
        if (importPath.startsWith("@")) {
            // For scoped packages, take @scope/package
            const parts = importPath.split("/");
            packageName = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
        } else {
            // For regular packages, take first part
            packageName = importPath.split("/")[0]!;
        }

        // Skip Node.js built-in modules (without node: prefix)
        const basePackageName = packageName.startsWith("@")
            ? packageName.split("/")[0]!
            : packageName;
        if (NODE_BUILTIN_MODULES.has(basePackageName)) {
            return null;
        }

        return {
            relativePath: importPath,
            bazelTarget: `//:node_modules/${packageName}`,
            isNodeModule: true,
        };
    }

    let resolvedFilePath: string;

    // Handle ~ imports (workspace root relative)
    if (importPath.startsWith("~/")) {
        resolvedFilePath = importPath.substring(2).replace(/\.js$/, ".ts");
        if (!resolvedFilePath.endsWith(".ts") && !resolvedFilePath.endsWith(".tsx")) {
            resolvedFilePath += ".ts";
        }
    }
    // Handle relative imports (./foo or ../foo)
    else if (importPath.startsWith(".")) {
        const resolvedPath = path.resolve(currentDir, importPath.replace(/\.js$/, ".ts"));
        const workspaceRoot = process.cwd();
        resolvedFilePath = path.relative(workspaceRoot, resolvedPath);
        if (!resolvedFilePath.endsWith(".ts") && !resolvedFilePath.endsWith(".tsx")) {
            resolvedFilePath += ".ts";
        }
    } else {
        return null;
    }

    // Check if the .ts file exists, if not try .tsx
    if (!fs.existsSync(resolvedFilePath)) {
        const tsxPath = resolvedFilePath.replace(/\.ts$/, ".tsx");
        if (fs.existsSync(tsxPath)) {
            resolvedFilePath = tsxPath;
        } else {
            // File doesn't exist, still try to get the package
        }
    }

    const bazelTarget = getBazelTargetForFile(resolvedFilePath);
    if (bazelTarget) {
        return {
            relativePath: resolvedFilePath,
            bazelTarget: bazelTarget,
            isNodeModule: false,
        };
    }

    return null;
}

/**
 * Extracts imports from a TypeScript file
 */
function extractImportsFromFile(filePath: string): Array<ImportInfo> {
    const content = fs.readFileSync(filePath, "utf-8");
    const imports: Array<ImportInfo> = [];
    const currentDir = path.dirname(filePath);

    // Match import statements
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?["']([^"']+)["']/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        if (importPath) {
            const importInfo = convertImportToBazelTarget(importPath, currentDir);
            if (importInfo) {
                imports.push(importInfo);
            }
        }
    }

    return imports;
}

/**
 * Finds all ts_project blocks in BUILD file content
 */
function findAllTsProjectBlocks(
    content: string,
): Array<{start: number; end: number; content: string}> {
    const blocks: Array<{start: number; end: number; content: string}> = [];
    let searchStart = 0;

    while (true) {
        const tsProjectStart = content.indexOf("ts_project(", searchStart);
        if (tsProjectStart === -1) {
            break; // No more ts_project blocks
        }

        // Find the matching closing parenthesis
        let depth = 0;
        let i = tsProjectStart + "ts_project(".length;
        while (i < content.length) {
            if (content[i] === "(") {
                depth++;
            } else if (content[i] === ")") {
                if (depth === 0) {
                    break; // Found the matching closing parenthesis
                }
                depth--;
            }
            i++;
        }

        if (i >= content.length) {
            break; // No matching closing parenthesis found
        }

        const blockContent = content.substring(tsProjectStart + "ts_project(".length, i);
        blocks.push({
            start: tsProjectStart,
            end: i + 1, // Include the closing parenthesis
            content: blockContent,
        });

        searchStart = i + 1; // Continue searching after this block
    }

    return blocks;
}

/**
 * Parses the content of a ts_project block
 */
function parseTsProjectContent(
    tsProjectContent: string | undefined,
    buildFilePath: string,
): BuildFileConfig | null {
    if (!tsProjectContent) {
        return null;
    }

    // Extract the name from ts_project block
    const nameMatch = tsProjectContent.match(/name\s*=\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : path.basename(path.dirname(buildFilePath));

    // Extract deps array from ts_project block
    const depsMatch = tsProjectContent.match(/deps\s*=\s*\[([\s\S]*?)\]/);
    const deps: Array<string> = [];
    if (depsMatch) {
        const depsContent = depsMatch[1];
        if (depsContent) {
            const depMatches = depsContent.match(/"([^"]+)"/g);
            if (depMatches) {
                deps.push(...depMatches.map((dep: string) => dep.slice(1, -1)));
            }
        }
    }

    // Extract test_deps array from ts_project block
    const testDepsMatch = tsProjectContent.match(/test_deps\s*=\s*\[([\s\S]*?)\]/);
    const testDeps: Array<string> = [];
    if (testDepsMatch) {
        const testDepsContent = testDepsMatch[1];
        if (testDepsContent) {
            const testDepMatches = testDepsContent.match(/"([^"]+)"/g);
            if (testDepMatches) {
                testDeps.push(...testDepMatches.map((dep: string) => dep.slice(1, -1)));
            }
        }
    }

    // Extract visibility section as raw text (don't try to parse complex patterns)
    // Use proper parenthesis matching for complex expressions like list comprehensions
    const visibilityMatch = tsProjectContent.match(/visibility\s*=\s*\[/);
    let visibilityRaw: string | undefined;
    if (visibilityMatch) {
        const start = visibilityMatch.index! + visibilityMatch[0].length;
        const end = findMatchingClosingBracket(tsProjectContent, start - 1);
        if (end !== -1) {
            visibilityRaw = tsProjectContent.substring(start, end).trim();
        }
    }

    // Extract testonly flag
    const testonlyMatch = tsProjectContent.match(/testonly\s*=\s*(True|False)/);
    const testonly = testonlyMatch && testonlyMatch[1] === "True" ? true : undefined;

    const finalName = name || path.basename(path.dirname(buildFilePath));
    return {
        name: finalName,
        deps,
        testDeps,
        visibilityRaw,
        testonly,
    };
}

/**
 * Parses a BUILD file and extracts the ts_project configuration
 * If there are multiple ts_project rules, finds the one matching the directory name
 */
function parseBuildFile(buildFilePath: string, preferredName?: string): BuildFileConfig | null {
    if (!fs.existsSync(buildFilePath)) {
        return null;
    }

    const content = fs.readFileSync(buildFilePath, "utf-8");

    // Check if this BUILD file contains a ts_project rule
    if (!content.includes("ts_project(")) {
        return null;
    }

    // Find all ts_project blocks and choose the right one
    const allTsProjects = findAllTsProjectBlocks(content);
    if (allTsProjects.length === 0) {
        return null;
    }

    // If there's only one, use it
    if (allTsProjects.length === 1) {
        const tsProjectContent = allTsProjects[0]?.content;
        return parseTsProjectContent(tsProjectContent, buildFilePath);
    }

    // If there are multiple, try to find the one matching the preferred name
    const defaultName = preferredName || path.basename(path.dirname(buildFilePath));
    for (const tsProject of allTsProjects) {
        const nameMatch = tsProject.content.match(/name\s*=\s*"([^"]+)"/);
        if (nameMatch && nameMatch[1] === defaultName) {
            return parseTsProjectContent(tsProject.content, buildFilePath);
        }
    }

    // If no match found, use the first one and warn
    // eslint-disable-next-line no-console
    console.log(`Multiple ts_project rules found in ${buildFilePath}, using the first one`);
    return parseTsProjectContent(allTsProjects[0]?.content, buildFilePath);
}

/**
 * Generates a ts_project rule content from configuration
 */
function generateTsProjectContent(config: BuildFileConfig): string {
    let content = `ts_project(\n`;
    // eslint-disable-next-line cyberworlds/string-quotes
    content += `    name = "${config.name}",\n`;

    if (config.testDeps.length > 0) {
        content += `    test_deps = [\n`;
        for (const dep of config.testDeps.sort()) {
            // eslint-disable-next-line cyberworlds/string-quotes
            content += `        "${dep}",\n`;
        }
        content += `    ],\n`;
    }

    if (config.testonly) {
        content += `    testonly = True,\n`;
    }

    if (config.visibilityRaw) {
        // Preserve the raw visibility exactly as it was
        content += `    visibility = [\n        ${config.visibilityRaw}\n    ],\n`;
    }

    if (config.deps.length > 0) {
        content += `    deps = [\n`;
        for (const dep of config.deps.sort()) {
            // eslint-disable-next-line cyberworlds/string-quotes
            content += `        "${dep}",\n`;
        }
        content += `    ],\n`;
    }

    content += `)`;

    return content;
}

/**
 * Generates a complete BUILD file content from configuration (for new files)
 */
function generateBuildFileContent(config: BuildFileConfig): string {
    // eslint-disable-next-line cyberworlds/string-quotes
    let content = `load("//admin/typescript:typescript.bzl", "ts_project")\n\n`;
    content += generateTsProjectContent(config);
    content += `\n`;
    return content;
}

/**
 * Scans directory for TypeScript files and extracts all dependencies
 */
function scanDirectoryForDeps(dirPath: string): {deps: Set<string>; testDeps: Set<string>} {
    const deps = new Set<string>();
    const testDeps = new Set<string>();

    function scanDir(currentPath: string) {
        const entries = fs.readdirSync(currentPath, {withFileTypes: true});

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);

            if (
                entry.isDirectory() &&
                entry.name !== "node_modules" &&
                !entry.name.startsWith(".")
            ) {
                // Skip child directories that have their own BUILD file
                const childBuildFile = path.join(fullPath, "BUILD");
                if (!fs.existsSync(childBuildFile)) {
                    scanDir(fullPath);
                }
            } else if (
                entry.isFile() &&
                (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
            ) {
                const imports = extractImportsFromFile(fullPath);
                const isTestFile = entry.name.includes(".test.") || entry.name.includes(".spec.");

                for (const importInfo of imports) {
                    // Add the dependency, but exclude self-references within the same package
                    const dirBazelPath = `//${path.relative(process.cwd(), dirPath)}`;
                    const targetPackage = importInfo.bazelTarget.split(":")[0];

                    if (targetPackage && targetPackage !== dirBazelPath) {
                        // Skip dependencies to direct child packages to avoid circular dependencies,
                        // but allow them if we're not creating a cycle in the same dependency type
                        const isChildPackage =
                            targetPackage.startsWith(dirBazelPath + "/") &&
                            !targetPackage.substring(dirBazelPath.length + 1).includes("/");

                        if (!isChildPackage) {
                            // Special handling for test_helpers: they should only go in test_deps
                            const isTestHelper = importInfo.bazelTarget.includes("test_helpers");

                            if (isTestHelper) {
                                testDeps.add(importInfo.bazelTarget);
                            } else {
                                const targetSet = isTestFile ? testDeps : deps;
                                targetSet.add(importInfo.bazelTarget);
                            }
                        } else {
                            // For child packages, only add the dependency if it won't create a circular dependency
                            // TODO: This is a simplified check - ideally we'd check the actual BUILD file of the child
                            // to see if it depends back on us, but for now we'll allow child dependencies
                            // Note: This may create circular dependencies, but we allow it for valid use cases
                            const isTestHelper = importInfo.bazelTarget.includes("test_helpers");
                            if (isTestHelper) {
                                testDeps.add(importInfo.bazelTarget);
                            } else {
                                const targetSet = isTestFile ? testDeps : deps;
                                targetSet.add(importInfo.bazelTarget);
                            }
                        }
                    }
                }
            }
        }
    }

    scanDir(dirPath);
    return {deps, testDeps};
}

/**
 * Finds the nearest BUILD file by traversing up the directory tree
 */
function findNearestBuildFile(startDir: string): string | null {
    let currentDir = startDir;
    const workspaceRoot = process.cwd();

    while (currentDir.startsWith(workspaceRoot)) {
        const buildFilePath = path.join(currentDir, "BUILD");
        if (fs.existsSync(buildFilePath)) {
            return buildFilePath;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break; // Reached filesystem root
        }
        currentDir = parentDir;
    }

    return null;
}

/**
 * Updates BUILD file for a given directory
 */
function updateBuildFile(dirPath: string) {
    // First try to find BUILD file in the directory, then traverse up
    const buildFilePath = findNearestBuildFile(dirPath);

    if (!buildFilePath) {
        // eslint-disable-next-line no-console
        console.log(`No BUILD file found for directory ${dirPath}, skipping...`);
        return;
    }

    const content = fs.readFileSync(buildFilePath, "utf-8");

    // Check if this has any ts_project rules
    const tsProjectMatches = content.match(/ts_project\(/g);
    if (!tsProjectMatches || tsProjectMatches.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`No ts_project rule found in ${buildFilePath}, skipping...`);
        return;
    }

    // For files with multiple ts_project rules, check if they have complex patterns
    if (tsProjectMatches.length > 1) {
        // Check if any of the rules have custom srcs attributes (indicating complex setup)
        if (content.includes("srcs = glob(") || content.includes("srcs=glob(")) {
            // eslint-disable-next-line no-console
            console.log(
                `Skipping ${buildFilePath} - contains ${tsProjectMatches.length} ts_project rules with custom srcs patterns`,
            );
            return;
        }

        // eslint-disable-next-line no-console
        console.log(
            `Warning: ${buildFilePath} contains ${tsProjectMatches.length} ts_project rules. ` +
                `Will attempt to update the rule that matches the directory name.`,
        );
    }

    // Use the BUILD file's directory for scanning, not the original dirPath
    const buildFileDir = path.dirname(buildFilePath);
    const directoryName = path.basename(buildFileDir);
    const existingConfig = parseBuildFile(buildFilePath, directoryName);
    if (!existingConfig) {
        // eslint-disable-next-line no-console
        console.log(`No ts_project rule found in ${buildFilePath}, skipping...`);
        return;
    }

    // Scan the BUILD file's directory for dependencies, not the original changed file's directory
    const {deps, testDeps} = scanDirectoryForDeps(buildFileDir);

    // Replace only the specific ts_project rule using proper parenthesis matching
    const fileContent = fs.readFileSync(buildFilePath, "utf-8");
    const allTsProjects = findAllTsProjectBlocks(fileContent);

    if (allTsProjects.length === 0) {
        // eslint-disable-next-line no-console
        console.error(`No ts_project rule found in ${buildFilePath}`);
        return;
    }

    // Find the ts_project block to replace (matching the name we parsed)
    let targetBlock = allTsProjects[0]; // Default to first one

    if (allTsProjects.length > 1) {
        // Try to find the block with the matching name
        for (const block of allTsProjects) {
            const nameMatch = block.content.match(/name\s*=\s*"([^"]+)"/);
            if (nameMatch && nameMatch[1] === existingConfig.name) {
                targetBlock = block;
                break;
            }
        }
    }

    if (!targetBlock) {
        // eslint-disable-next-line no-console
        console.error(`Could not find target ts_project block in ${buildFilePath}`);
        return;
    }

    // Preserve certain essential dependencies that were in the original config
    // This handles cases like @types/* which are needed for TypeScript compilation but not detected by import scanning
    const preservedDeps = new Set(deps);
    for (const existingDep of existingConfig.deps) {
        if (existingDep.includes("@types/") || existingDep.includes("node_modules/@types")) {
            preservedDeps.add(existingDep);
        }
    }

    const preservedTestDeps = new Set(testDeps);
    for (const existingTestDep of existingConfig.testDeps) {
        if (
            existingTestDep.includes("@types/") ||
            existingTestDep.includes("node_modules/@types")
        ) {
            preservedTestDeps.add(existingTestDep);
        }
    }

    // Filter test_deps to exclude targets already present in deps
    const finalDeps = Array.from(preservedDeps);
    const finalTestDeps = Array.from(preservedTestDeps).filter(
        testDep => !preservedDeps.has(testDep),
    );

    // Use the full replacement approach but preserve the original attributes
    const config: BuildFileConfig = {
        name: existingConfig.name,
        deps: finalDeps,
        testDeps: finalTestDeps,
        visibilityRaw: existingConfig.visibilityRaw,
        testonly: existingConfig.testonly,
    };

    // Replace the target block with the new content preserving visibility exactly
    const newTsProjectContent = generateTsProjectContent(config);
    const beforeTsProject = fileContent.substring(0, targetBlock.start);
    const afterTsProject = fileContent.substring(targetBlock.end);
    const newFileContent = beforeTsProject + newTsProjectContent + afterTsProject;

    if (newFileContent !== fileContent) {
        fs.writeFileSync(buildFilePath, newFileContent);
        // eslint-disable-next-line no-console
        console.log(`Updated BUILD file: ${buildFilePath}`);
    }
}

/**
 * Creates a new BUILD file for a directory
 */
function createBuildFile(dirPath: string) {
    const buildFilePath = path.join(dirPath, "BUILD");

    if (fs.existsSync(buildFilePath)) {
        // eslint-disable-next-line no-console
        console.log(`BUILD file already exists at ${buildFilePath}, use update mode instead`);
        return;
    }

    const {deps, testDeps} = scanDirectoryForDeps(dirPath);

    // Filter test_deps to exclude targets already present in deps
    const finalDeps = Array.from(deps);
    const finalTestDeps = Array.from(testDeps).filter(testDep => !deps.has(testDep));

    const config: BuildFileConfig = {
        name: path.basename(dirPath),
        deps: finalDeps,
        testDeps: finalTestDeps,
        // eslint-disable-next-line cyberworlds/string-quotes
        visibilityRaw: `"//app:__subpackages__",\n        "//client/web:__subpackages__",`,
    };

    const newContent = generateBuildFileContent(config);
    fs.writeFileSync(buildFilePath, newContent);
    // eslint-disable-next-line no-console
    console.log(`Created BUILD file at ${buildFilePath}`);
}

/**
 * Gets list of changed files since parent branch
 */
function getChangedFiles(): Array<string> {
    try {
        let parentBranch = "main"; // Default fallback

        try {
            // Try to get parent using Graphite
            parentBranch = execSync("gt parent", {
                encoding: "utf-8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
        } catch {
            // Fallback to main if gt parent fails
            parentBranch = "main";
        }

        const output = execSync(`git diff --name-only ${parentBranch}`, {encoding: "utf-8"});
        return output.split("\n").filter((line: string) => line.trim() !== "");
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error getting changed files:", error);
        return [];
    }
}

/**
 * Gets unique BUILD file directories for changed TypeScript files
 * This prevents processing the same BUILD file multiple times when multiple files
 * in the same package are changed
 */
function getChangedDirectories(): Array<string> {
    const changedFiles = getChangedFiles();
    const buildDirectories = new Set<string>();

    for (const file of changedFiles) {
        if (file.endsWith(".ts") || file.endsWith(".tsx")) {
            const fileDir = path.resolve(path.dirname(file));

            // Find the BUILD file directory for this changed file
            const buildFilePath = findNearestBuildFile(fileDir);
            if (buildFilePath) {
                const buildFileDir = path.dirname(buildFilePath);
                buildDirectories.add(buildFileDir);
            }
        }
    }

    return Array.from(buildDirectories);
}

function main() {
    const args = process.argv.slice(2);

    // Change to workspace root if we're running from bazel
    const workspaceRoot = process.env.BUILD_WORKSPACE_DIRECTORY || process.cwd();
    process.chdir(workspaceRoot);

    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        // eslint-disable-next-line no-console
        console.log(helpText);
        process.exit(0);
    }

    if (args[0] === "--diff") {
        const changedDirs = getChangedDirectories();

        // Build cache once for all directories
        // eslint-disable-next-line no-console
        console.log("Building file-to-target cache...");
        buildFileToTargetCache();
        // eslint-disable-next-line no-console
        console.log(`Cache built with ${fileToTargetCache?.size || 0} file mappings`);

        for (const dir of changedDirs) {
            updateBuildFile(dir);
        }
    } else if (args[0] === "--create") {
        if (args.length < 2) {
            // eslint-disable-next-line no-console
            console.error("Error: --create requires a directory path");
            process.exit(1);
        }
        const dirPath = path.resolve(args[1] ?? "");
        createBuildFile(dirPath);
    } else {
        // Handle multiple directories or single directory
        const directories = args.map(arg => path.resolve(arg));

        // Validate all directories exist
        for (const dirPath of directories) {
            if (!fs.existsSync(dirPath)) {
                // eslint-disable-next-line no-console
                console.error(`Error: Directory ${dirPath} does not exist`);
                process.exit(1);
            }
        }

        if (directories.length > 1) {
            // Multiple directories - build cache once
            // eslint-disable-next-line no-console
            console.log(
                `Updating BUILD file dependencies for ${directories.length} directories...`,
            );
            // eslint-disable-next-line no-console
            console.log("Building file-to-target cache...");
            buildFileToTargetCache();
            // eslint-disable-next-line no-console
            console.log(`Cache built with ${fileToTargetCache?.size || 0} file mappings`);

            for (const dirPath of directories) {
                // eslint-disable-next-line no-console
                console.log(`Processing: ${dirPath}`);
                updateBuildFile(dirPath);
            }
        } else {
            // Single directory - existing behavior
            updateBuildFile(directories[0]!);
        }
    }
}

// Check if this is the main module in ES module environment
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
