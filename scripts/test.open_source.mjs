// Public build scripts live outside the workspace source directories, so they use
// ordinary relative module paths.
/* eslint-disable cyberworlds/sort-imports-by-source */
import {createEsbuildWorkspacePlugin} from "./esbuild_workspace_plugin.open_source.mjs";
import {build} from "esbuild";
import {spawnSync} from "node:child_process";
import {readdir, rm} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const scriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const repositoryPath = resolve(scriptDirectoryPath, "..");
const sourcePath = repositoryPath;
const outputPath = join(repositoryPath, ".test-output");
const jestPath = join(repositoryPath, "node_modules", "jest", "bin", "jest.js");
const testSourcePaths = await listTestSourcePaths(sourcePath);

if (testSourcePaths.length === 0) {
    throw new Error("The repository does not contain any tests");
}

try {
    await rm(outputPath, {force: true, recursive: true});
    await build({
        absWorkingDir: repositoryPath,
        bundle: true,
        entryPoints: testSourcePaths,
        external: ["lmdb"],
        format: "esm",
        logLevel: "info",
        outbase: sourcePath,
        outdir: outputPath,
        platform: "node",
        plugins: [createEsbuildWorkspacePlugin(repositoryPath)],
        sourcemap: true,
        target: "node22",
        tsconfig: join(repositoryPath, "tsconfig.json"),
    });

    const testOutputPaths = testSourcePaths.map(testSourcePath => {
        const relativeTestPath = relative(sourcePath, testSourcePath);
        return join(outputPath, relativeTestPath.replace(/\.[cm]?tsx?$/u, ".js"));
    });

    const result = spawnSync(
        process.execPath,
        ["--experimental-vm-modules", jestPath, "--runInBand", "--runTestsByPath", ...testOutputPaths],
        {
            cwd: repositoryPath,
            stdio: "inherit",
        },
    );

    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
    await rm(outputPath, {force: true, recursive: true});
}

/** Lists every published TypeScript test in deterministic path order. */
async function listTestSourcePaths(directoryPath) {
    const filePaths = [];
    const excludedDirectoryNames = new Set([
        ".git",
        ".test-output",
        "dist",
        "node_modules",
    ]);
    async function visit(currentPath) {
        const entries = await readdir(currentPath, {withFileTypes: true});
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const entryPath = join(currentPath, entry.name);
            if (entry.isDirectory() && !excludedDirectoryNames.has(entry.name)) {
                await visit(entryPath);
            } else if (/\.test\.[cm]?tsx?$/u.test(entry.name)) filePaths.push(entryPath);
        }
    }
    await visit(directoryPath);
    return filePaths;
}
