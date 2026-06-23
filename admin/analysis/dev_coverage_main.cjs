#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yargs = require("yargs/yargs");

main();

/**
 * Runs Jest unit tests with coverage enabled and writes aggregate reports.
 *
 * This is the implementation behind `dev coverage`. It discovers the matching
 * Bazel Jest targets, runs them with `ALPINE_JEST_COVERAGE=1`, then delegates the
 * final report generation to the shared merge script.
 */
function main() {
    try {
        const args = readArgs(process.argv.slice(2));
        const workspacePath = args.workspace ?? getWorkspacePath();
        const coverageRun = createCoverageRun({
            packageArg: args.package,
            workspacePath,
        });
        const targetLabels = queryCoverageTargets({
            coverageQueryTarget: coverageRun.coverageQueryTarget,
            hasLibreOffice: hasLibreOfficeInstalled(),
            workspacePath,
        });

        if (targetLabels.length === 0) {
            writeStdout(`No unit tests for ${coverageRun.coverageDescription}`);
            return;
        }

        const coverageOutputPath = path.join(
            workspacePath,
            "admin",
            "coverage",
            coverageRun.coverageReportName,
        );
        writeStdout(
            `Running coverage for ${targetLabels.length} target(s): ${coverageRun.coverageDescription}`,
        );
        writeStdout(`Reports will be written to: ${coverageOutputPath}`);

        const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "dev-coverage-"));
        try {
            const targetsFilePath = path.join(tempPath, "targets.txt");
            fs.writeFileSync(targetsFilePath, `${targetLabels.join("\n")}\n`);

            runCoverageTests({targetLabels, workspacePath});
            runMergeJestCoverage({
                coverageOutputPath,
                targetsFilePath,
                workspacePath,
            });
        } finally {
            fs.rmSync(tempPath, {force: true, recursive: true});
        }
    } catch (error) {
        writeStderr(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

/**
 * Reads and validates CLI options for the local coverage command.
 */
function readArgs(argv) {
    const args = yargs(argv)
        .scriptName("dev coverage")
        .usage("$0 [package]")
        .option("workspace", {
            coerce: value => path.resolve(value),
            describe: "Repository root. Defaults to git rev-parse --show-toplevel.",
            hidden: true,
            type: "string",
        })
        .check(parsedArgs => {
            if (parsedArgs._.length > 1) {
                throw new Error("Usage: dev coverage [package]");
            }
            return true;
        })
        .fail((message, error) => {
            throw error ?? new Error(message);
        })
        .help()
        .strictOptions()
        .parseSync();

    return {
        package: args._[0] === undefined ? undefined : String(args._[0]),
        workspace: args.workspace,
    };
}

/**
 * Creates the Bazel query target and report location for a coverage run.
 */
function createCoverageRun({packageArg, workspacePath}) {
    const coveragePackagePath = normalizeCoveragePackagePath(packageArg);
    if (coveragePackagePath.length === 0) {
        return {
            coverageDescription: "all Jest unit tests",
            coverageQueryTarget: "//...",
            coverageReportName: "all",
        };
    }

    if (coveragePackagePath.includes("..") || path.isAbsolute(coveragePackagePath)) {
        throw new Error(`Invalid package path: ${packageArg}`);
    }
    if (!fs.existsSync(path.join(workspacePath, coveragePackagePath, "BUILD"))) {
        throw new Error(`No Bazel package found at: ${coveragePackagePath}`);
    }

    return {
        coverageDescription: `Jest unit tests in //${coveragePackagePath}`,
        coverageQueryTarget: `//${coveragePackagePath}:all`,
        coverageReportName: coveragePackagePath,
    };
}

/**
 * Normalizes the optional package argument into a workspace-relative path.
 */
function normalizeCoveragePackagePath(packageArg) {
    if (!packageArg) return "";

    let coveragePackagePath = packageArg.startsWith("//") ? packageArg.slice(2) : packageArg;
    const targetSeparatorIndex = coveragePackagePath.indexOf(":");
    if (targetSeparatorIndex !== -1) {
        coveragePackagePath = coveragePackagePath.slice(0, targetSeparatorIndex);
    }
    return coveragePackagePath.replace(/\/+$/u, "");
}

/**
 * Queries Bazel for Jest unit-test targets in the selected scope.
 */
function queryCoverageTargets({coverageQueryTarget, hasLibreOffice, workspacePath}) {
    const bazelQueryQuote = String.fromCharCode(39);
    const queryBase = `tests(${coverageQueryTarget})`;
    let query = `attr(tags, ${bazelQueryQuote}\\bdev-test\\b${bazelQueryQuote}, ${queryBase})`;
    query = `attr(tags, ${bazelQueryQuote}\\bjest\\b${bazelQueryQuote}, ${query})`;
    query = `${query} except attr(tags, ${bazelQueryQuote}\\badhoc\\b${bazelQueryQuote}, ${queryBase})`;
    if (!hasLibreOffice) {
        query = `${query} except attr(tags, ${bazelQueryQuote}\\blibreoffice\\b${bazelQueryQuote}, ${queryBase})`;
    }

    const stdout = runBazel(["query", "--noshow_progress", query], {workspacePath});
    return stdout
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

/**
 * Checks whether this machine can run LibreOffice-tagged tests.
 */
function hasLibreOfficeInstalled() {
    switch (process.platform) {
        case "darwin":
            return fs.existsSync("/Applications/LibreOffice.app/Contents/MacOS/soffice");
        case "linux":
            return [
                "/usr/bin/libreoffice",
                "/usr/bin/soffice",
                "/snap/bin/libreoffice",
                "/opt/libreoffice/program/soffice",
            ].some(filePath => fs.existsSync(filePath));
        default:
            return false;
    }
}

/**
 * Runs selected Bazel test targets with Jest coverage enabled.
 */
function runCoverageTests({targetLabels, workspacePath}) {
    const bazelPath = bazelExecutablePath(workspacePath);
    const result = childProcess.spawnSync(
        "xargs",
        [bazelPath, "test", "--test_env=ALPINE_JEST_COVERAGE=1"],
        {
            cwd: workspacePath,
            encoding: "utf8",
            input: `${targetLabels.join("\n")}\n`,
            stdio: ["pipe", "inherit", "inherit"],
        },
    );
    if (result.status !== 0) {
        throw new Error(`Coverage tests failed with status ${formatStatus(result)}`);
    }
}

/**
 * Runs the shared coverage merge script against local Bazel testlogs.
 */
function runMergeJestCoverage({coverageOutputPath, targetsFilePath, workspacePath}) {
    const bazelTestlogsPath = runBazel(["info", "bazel-testlogs"], {workspacePath});
    const result = childProcess.spawnSync(
        process.execPath,
        [
            path.join(__dirname, "merge_jest_coverage.cjs"),
            "--workspace",
            workspacePath,
            "--targets-file",
            targetsFilePath,
            "--testlogs",
            bazelTestlogsPath,
            "--output",
            coverageOutputPath,
        ],
        {
            cwd: workspacePath,
            env: {
                ...process.env,
                NODE_PATH: nodePathEnv(workspacePath),
            },
            stdio: "inherit",
        },
    );
    if (result.status !== 0) {
        throw new Error(`Jest coverage merge failed with status ${formatStatus(result)}`);
    }
}

/**
 * Finds the repository root for local invocations.
 */
function getWorkspacePath() {
    return runGit(["rev-parse", "--show-toplevel"], {cwd: process.cwd()});
}

/**
 * Builds a Node module search path for source checkouts.
 */
function nodePathEnv(workspacePath) {
    return [
        path.join(workspacePath, "node_modules", ".pnpm", "node_modules"),
        path.join(workspacePath, "node_modules"),
        process.env.NODE_PATH,
    ]
        .filter(value => value)
        .join(path.delimiter);
}

/**
 * Runs the repo's Bazel wrapper and returns trimmed stdout.
 */
function runBazel(args, {workspacePath}) {
    return runCommand(bazelExecutablePath(workspacePath), args, {cwd: workspacePath});
}

/**
 * Runs a git command and returns trimmed stdout.
 */
function runGit(args, {cwd}) {
    return runCommand("git", args, {cwd});
}

/**
 * Runs a command and returns trimmed stdout when it succeeds.
 */
function runCommand(command, args, {cwd}) {
    const result = childProcess.spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${command} ${args.join(" ")} failed`);
    }
    return result.stdout.trim();
}

/**
 * Resolves the repo-local Bazel executable path.
 */
function bazelExecutablePath(workspacePath) {
    return path.join(workspacePath, "admin", "bin", "bazel");
}

/**
 * Formats a child process exit status or signal for error messages.
 */
function formatStatus(result) {
    return result.status === null ? `signal ${result.signal}` : String(result.status);
}

function writeStdout(value) {
    process.stdout.write(`${value}\n`);
}

function writeStderr(value) {
    process.stderr.write(`${value}\n`);
}
