#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yargs = require("yargs/yargs");
const {isCoverageSourceFile} = require("./coverage_source_file.cjs");

main();

/**
 * Runs Jest unit tests with coverage enabled and writes aggregate reports.
 *
 * This is the implementation behind `dev coverage`. It discovers the matching
 * Bazel Jest targets, then delegates the final report generation to the shared
 * merge script.
 */
function main() {
    try {
        const args = readArgs(process.argv.slice(2));
        const workspacePath = args.workspace ?? getWorkspacePath();
        const coverageRun = createCoverageRun({
            inputArg: args.input,
            workspacePath,
        });

        if (args.changedLinesOnly && !coverageRun.sourceFilePath) {
            throw new Error("--changed-lines-only requires a source file path.");
        }

        const targetLabels = queryCoverageTargets({
            coverageQueryTarget: coverageRun.coverageQueryTarget,
            hasLibreOffice: hasLibreOfficeInstalled(),
            workspacePath,
        });

        if (targetLabels.length === 0) {
            if (coverageRun.sourceFilePath) {
                throw new Error(
                    `No Jest unit test target found for adjacent test: ${coverageRun.testFilePath}`,
                );
            }
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

        if (!args.changedLinesOnly) {
            writeStdout(`Reports will be written to: ${coverageOutputPath}`);
        }

        const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "dev-coverage-"));
        try {
            const targetsFilePath = path.join(tempPath, "targets.txt");
            fs.writeFileSync(targetsFilePath, `${targetLabels.join("\n")}\n`);

            runCoverageTests({targetLabels, workspacePath});
            runMergeJestCoverage({
                changedLinesOnly: args.changedLinesOnly,
                coverageOutputPath,
                sourceFilePath: coverageRun.sourceFilePath,
                targetsFilePath,
                workspacePath,
            });

            if (args.changedLinesOnly) {
                runReportUncoveredChangedLines({
                    coverageFinalPath: path.join(coverageOutputPath, "coverage-final.json"),
                    sourceFilePath: coverageRun.sourceFilePath,
                    workspacePath,
                });
            }
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
        .usage("$0 [package|source file]")
        .option("changed-lines-only", {
            default: false,
            describe: "Only print uncovered changed lines for one source file.",
            type: "boolean",
        })
        .option("workspace", {
            coerce: value => path.resolve(value),
            describe: "Repository root. Defaults to git rev-parse --show-toplevel.",
            hidden: true,
            type: "string",
        })
        .check(parsedArgs => {
            if (parsedArgs._.length > 1) {
                throw new Error("Usage: dev coverage [package|source file]");
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
        changedLinesOnly: args.changedLinesOnly,
        input: args._[0] === undefined ? undefined : String(args._[0]),
        workspace: args.workspace,
    };
}

/**
 * Creates the Bazel query target and report location for a coverage run.
 */
function createCoverageRun({inputArg, workspacePath}) {
    const sourceCoverageRun = createSourceFileCoverageRun({inputArg, workspacePath});
    if (sourceCoverageRun) {
        return sourceCoverageRun;
    }

    const coveragePackagePath = normalizeCoveragePackagePath(inputArg);
    if (coveragePackagePath.length === 0) {
        return {
            coverageDescription: "all Jest unit tests",
            coverageQueryTarget: "//...",
            coverageReportName: "all",
        };
    }

    if (coveragePackagePath.includes("..") || path.isAbsolute(coveragePackagePath)) {
        throw new Error(`Invalid package path: ${inputArg}`);
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
 * Creates a coverage run for one source file and its adjacent unit test.
 */
function createSourceFileCoverageRun({inputArg, workspacePath}) {
    if (!inputArg) return null;

    const sourceFilePath = normalizeSourceFilePath({inputArg, workspacePath});
    if (!sourceFilePath || !fs.existsSync(path.join(workspacePath, sourceFilePath))) {
        return null;
    }

    if (!isCoverageSourceFile(sourceFilePath)) {
        throw new Error(
            `Coverage source file must be a non-test TypeScript or JavaScript file: ${inputArg}`,
        );
    }

    const testFilePath = adjacentTestFilePath({sourceFilePath, workspacePath});
    if (!testFilePath) {
        throw new Error(
            `No adjacent test found for ${sourceFilePath}. Run dev test ${sourceFilePath} to see coverage from affected tests; this command only runs the adjacent test file for coverage.`,
        );
    }

    const packagePath = findBazelPackagePath({filePath: testFilePath, workspacePath});
    const testRelativePath =
        packagePath.length === 0 ? testFilePath : testFilePath.slice(`${packagePath}/`.length);
    const testLabelName = testRelativePath.endsWith(".test.tsx")
        ? `${testRelativePath.slice(0, -".test.tsx".length)}_test`
        : `${testRelativePath.slice(0, -".test.ts".length)}_test`;

    return {
        coverageDescription: `adjacent Jest unit test for ${sourceFilePath}`,
        coverageQueryTarget: `//${packagePath}:${testLabelName}`,
        coverageReportName: sourceFilePath.replace(/\.[^.]+$/u, ""),
        sourceFilePath,
        testFilePath,
    };
}

/**
 * Normalizes the optional package argument into a workspace-relative path.
 */
function normalizeCoveragePackagePath(packageArg) {
    if (!packageArg) return "";

    let coveragePackagePath = packageArg.startsWith("//") ? packageArg.slice(2) : packageArg;
    if (coveragePackagePath.startsWith("./")) {
        coveragePackagePath = coveragePackagePath.slice(2);
    }

    const targetSeparatorIndex = coveragePackagePath.indexOf(":");
    if (targetSeparatorIndex !== -1) {
        coveragePackagePath = coveragePackagePath.slice(0, targetSeparatorIndex);
    }

    return coveragePackagePath.replace(/\/+$/u, "");
}

/**
 * Normalizes a possible source-file argument into a workspace-relative path.
 */
function normalizeSourceFilePath({inputArg, workspacePath}) {
    let candidatePath = inputArg.startsWith("./") ? inputArg.slice(2) : inputArg;
    if (candidatePath.startsWith(`${workspacePath}/`)) {
        candidatePath = candidatePath.slice(workspacePath.length + 1);
    } else if (path.isAbsolute(candidatePath)) {
        throw new Error(`Invalid source file path: ${inputArg}`);
    }

    return candidatePath;
}

/**
 * Finds the adjacent Jest test file for a source file.
 */
function adjacentTestFilePath({sourceFilePath, workspacePath}) {
    const sourceBasePath = sourceFilePath.replace(/\.[^.]+$/u, "");
    for (const extension of [".test.ts", ".test.tsx"]) {
        const testFilePath = `${sourceBasePath}${extension}`;
        if (fs.existsSync(path.join(workspacePath, testFilePath))) {
            return testFilePath;
        }
    }
    return null;
}

/**
 * Finds the Bazel package that owns a file.
 */
function findBazelPackagePath({filePath, workspacePath}) {
    let packagePath = path.dirname(filePath);
    while (packagePath !== ".") {
        if (fs.existsSync(path.join(workspacePath, packagePath, "BUILD"))) {
            return packagePath;
        }
        packagePath = path.dirname(packagePath);
    }
    if (fs.existsSync(path.join(workspacePath, "BUILD"))) {
        return "";
    }
    throw new Error(`No Bazel package found for adjacent test: ${filePath}`);
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
 * Runs selected Bazel test targets.
 */
function runCoverageTests({targetLabels, workspacePath}) {
    const bazelPath = bazelExecutablePath(workspacePath);
    const result = childProcess.spawnSync("xargs", [bazelPath, "test"], {
        cwd: workspacePath,
        encoding: "utf8",
        input: `${targetLabels.join("\n")}\n`,
        stdio: ["pipe", "inherit", "inherit"],
    });
    if (result.status !== 0) {
        throw new Error(`Coverage tests failed with status ${formatStatus(result)}`);
    }
}

/**
 * Runs the shared coverage merge script against local Bazel testlogs.
 */
function runMergeJestCoverage({
    changedLinesOnly,
    coverageOutputPath,
    sourceFilePath,
    targetsFilePath,
    workspacePath,
}) {
    const bazelTestlogsPath = runBazel(["info", "bazel-testlogs"], {workspacePath});
    const sourceFileArgs = sourceFilePath ? ["--source-file", sourceFilePath] : [];
    const changedLinesOnlyArgs = changedLinesOnly ? ["--quiet", "--no-honeycomb"] : [];
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
            ...sourceFileArgs,
            ...changedLinesOnlyArgs,
        ],
        {
            cwd: workspacePath,
            stdio: "inherit",
        },
    );
    if (result.status !== 0) {
        throw new Error(`Jest coverage merge failed with status ${formatStatus(result)}`);
    }
}

/**
 * Prints uncovered changed lines from a single-file coverage report.
 */
function runReportUncoveredChangedLines({coverageFinalPath, sourceFilePath, workspacePath}) {
    const result = childProcess.spawnSync(
        process.execPath,
        [
            path.join(__dirname, "report_uncovered_lines.cjs"),
            "--workspace",
            workspacePath,
            "--coverage-final",
            coverageFinalPath,
            "--base",
            "main",
            "--expand-lines",
            "--",
            sourceFilePath,
        ],
        {
            cwd: workspacePath,
            stdio: "inherit",
        },
    );
    if (result.status !== 0) {
        throw new Error(`Changed-line coverage report failed with status ${formatStatus(result)}`);
    }
}

/**
 * Finds the repository root for local invocations.
 */
function getWorkspacePath() {
    const workingDirectoryPath = process.env.BUILD_WORKING_DIRECTORY || process.cwd();
    return runGit(["rev-parse", "--show-toplevel"], {cwd: workingDirectoryPath});
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
