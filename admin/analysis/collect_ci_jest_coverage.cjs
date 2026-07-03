#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yargs = require("yargs/yargs");

main();

/**
 * Collects CI unit-test coverage artifacts and delegates report generation.
 *
 * Each test shard uploads coverage as a GitHub Actions artifact. This script
 * rebuilds those artifacts into the Bazel testlogs shape that the shared merge
 * script expects, then lets that script handle coverage-map merging and report
 * generation.
 */
function main() {
    try {
        const args = readArgs(process.argv.slice(2));
        const workspacePath = args.workspace ?? getWorkspacePath();
        const artifactsPath = path.resolve(args.artifacts);
        const coverageOutputPath = path.resolve(
            workspacePath,
            args.coverageOutput ?? path.join("admin", "coverage", "all"),
        );

        const collectionPath = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-coverage-"));
        try {
            const collectedCoverage = collectCoverageArtifacts({
                artifactsPath,
                collectionPath,
            });
            runMergeJestCoverage({
                coverageOutputPath,
                targetsFilePath: collectedCoverage.targetsFilePath,
                testlogsPath: collectedCoverage.testlogsPath,
                workspacePath,
            });
        } finally {
            removeCollectedCoveragePath(collectionPath);
        }
    } catch (error) {
        writeStderr(error instanceof Error ? error.stack || error.message : String(error));
        process.exitCode = 1;
    }
}

/**
 * Reads and validates the CLI options for CI coverage collection.
 */
function readArgs(argv) {
    return yargs(argv)
        .scriptName("collect_ci_jest_coverage")
        .usage("$0 --artifacts <path> [options]")
        .option("artifacts", {
            demandOption: true,
            describe: "Unit coverage artifacts directory.",
            type: "string",
        })
        .option("coverage-output", {
            describe: "Merged coverage output directory. Defaults to admin/coverage/all.",
            type: "string",
        })
        .option("workspace", {
            coerce: value => path.resolve(value),
            describe: "Repository root. Defaults to git rev-parse --show-toplevel.",
            type: "string",
        })
        .help()
        .strict()
        .parseSync();
}

/**
 * Copies uploaded coverage artifacts into a temporary testlogs tree.
 *
 * The targets file is filtered to targets that actually produced Jest coverage
 * output, so a missing artifact from one target does not poison the whole merge.
 */
function collectCoverageArtifacts({artifactsPath, collectionPath}) {
    if (!fs.existsSync(artifactsPath)) {
        throw new Error(`Coverage artifacts directory does not exist: ${artifactsPath}`);
    }

    const testlogsPath = path.join(collectionPath, "testlogs");
    const targetsFilePath = path.join(collectionPath, "targets.txt");
    const targets = new Set();
    let artifactCount = 0;
    let missingTargetCount = 0;

    fs.mkdirSync(testlogsPath, {recursive: true});
    for (const artifactName of fs.readdirSync(artifactsPath).sort()) {
        const artifactPath = path.join(artifactsPath, artifactName);
        if (!fs.statSync(artifactPath).isDirectory()) {
            continue;
        }

        const targetsPath = path.join(artifactPath, "targets.txt");
        const artifactTestlogsPath = path.join(artifactPath, "testlogs");
        if (!fs.existsSync(targetsPath) && !fs.existsSync(artifactTestlogsPath)) {
            continue;
        }

        artifactCount++;
        if (fs.existsSync(targetsPath)) {
            for (const target of readLines(targetsPath)) {
                if (hasCoverageOutput({artifactTestlogsPath, target})) {
                    targets.add(target);
                } else {
                    missingTargetCount++;
                    writeStderr(`Skipping missing coverage output for ${target}`);
                }
            }
        }
        if (fs.existsSync(artifactTestlogsPath)) {
            fs.cpSync(artifactTestlogsPath, testlogsPath, {
                force: true,
                recursive: true,
            });
        }
    }

    if (artifactCount === 0) {
        throw new Error(`No unit coverage artifacts found in: ${artifactsPath}`);
    }
    if (targets.size === 0) {
        throw new Error("No Jest coverage targets found in unit coverage artifacts.");
    }

    fs.writeFileSync(targetsFilePath, `${Array.from(targets).sort().join("\n")}\n`);
    writeStdout(`Collected coverage artifacts: ${artifactCount}`);
    writeStdout(`Collected Jest targets: ${targets.size}`);
    if (missingTargetCount > 0) {
        writeStdout(`Skipped missing coverage targets: ${missingTargetCount}`);
    }
    return {targetsFilePath, testlogsPath};
}

/**
 * Checks whether a collected target has raw coverage JSON or zipped outputs.
 *
 * Some runners upload the direct test output tree while others upload Bazel's
 * `outputs.zip`, so the merge script supports both forms.
 */
function hasCoverageOutput({artifactTestlogsPath, target}) {
    const testOutputsPath = path.join(
        artifactTestlogsPath,
        testlogPathForLabel(target),
        "test.outputs",
    );
    return (
        fs.existsSync(path.join(testOutputsPath, "coverage", "coverage-final.json")) ||
        fs.existsSync(path.join(testOutputsPath, "outputs.zip"))
    );
}

/**
 * Converts a canonical Bazel target label into its testlogs-relative path.
 */
function testlogPathForLabel(targetLabel) {
    const match = /^\/\/([^:]*):(.+)$/.exec(targetLabel);
    if (!match) {
        throw new Error(`Expected canonical Bazel label, got: ${targetLabel}`);
    }

    const packagePath = match[1];
    const targetName = match[2];
    return packagePath.length === 0 ? targetName : path.join(packagePath, targetName);
}

/**
 * Runs the shared coverage merge script against the collected testlogs tree.
 *
 * The aggregate CI job intentionally runs this with a small `NODE_PATH` dependency
 * install instead of Bazel. That is not hermetic and breaks Bazel's rules, but
 * there is nothing Bazel-specific about statically merging uploaded coverage JSON
 * and zip files, and initializing the full Bazel cache here would add minutes.
 * Local Bazel callers still get dependencies from runfiles.
 */
function runMergeJestCoverage({coverageOutputPath, targetsFilePath, testlogsPath, workspacePath}) {
    const mergeScriptPath = path.join(__dirname, "merge_jest_coverage.cjs");
    const nodePath = process.execPath;
    const result = childProcess.spawnSync(
        nodePath,
        [
            mergeScriptPath,
            "--workspace",
            workspacePath,
            "--targets-file",
            targetsFilePath,
            "--testlogs",
            testlogsPath,
            "--output",
            coverageOutputPath,
        ],
        {
            cwd: workspacePath,
            stdio: "inherit",
        },
    );

    if (result.status !== 0) {
        throw new Error(`Jest coverage merge failed with status ${result.status}`);
    }
}

/**
 * Removes the temporary artifact collection directory.
 */
function removeCollectedCoveragePath(collectionPath) {
    if (!fs.existsSync(collectionPath)) return;
    makeWritable(collectionPath);
    fs.rmSync(collectionPath, {force: true, recursive: true});
}

/**
 * Makes extracted artifacts writable before cleanup.
 *
 * GitHub artifact zips can preserve read-only file modes. The cleanup step needs
 * to be able to remove the temporary tree even when those modes are present.
 */
function makeWritable(filePath) {
    const stats = fs.lstatSync(filePath);
    if (stats.isDirectory()) {
        fs.chmodSync(filePath, stats.mode | 0o700);
        for (const childName of fs.readdirSync(filePath)) {
            makeWritable(path.join(filePath, childName));
        }
    } else {
        fs.chmodSync(filePath, stats.mode | 0o600);
    }
}

/**
 * Reads a newline-delimited file while ignoring blank lines.
 */
function readLines(filePath) {
    return fs
        .readFileSync(filePath, "utf8")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

/**
 * Finds the repository root for local invocations.
 */
function getWorkspacePath() {
    return runGit(["rev-parse", "--show-toplevel"], {cwd: process.cwd()});
}

/**
 * Runs a git command and returns trimmed stdout.
 */
function runGit(args, {cwd}) {
    const result = childProcess.spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
    }
    return result.stdout.trim();
}

function writeStdout(value) {
    process.stdout.write(`${value}\n`);
}

function writeStderr(value) {
    process.stderr.write(`${value}\n`);
}
