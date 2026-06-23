#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const libCoverage = require("istanbul-lib-coverage");
const yargs = require("yargs/yargs");
const {
    isCoverageSourceFile,
    isTypeScriptCoverageSourceFile,
} = require("./coverage_source_file.cjs");

main();

/**
 * Reports changed source lines that were executable but not covered by unit tests.
 *
 * This script compares a zero-context git diff against Istanbul's
 * `coverage-final.json`. It prints warnings only for changed source lines, keeping
 * `dev test` focused on code introduced by the current branch instead of listing
 * every uncovered line in a file.
 */
function main() {
    try {
        const args = readArgs(process.argv.slice(2));
        const workspacePath = args.workspacePath ?? getWorkspacePath();
        const baseRef = args.baseRef ?? "main";
        const coverageFinalPath = path.resolve(
            workspacePath,
            args.coverageFinalPath ?? path.join("admin", "coverage", "test", "coverage-final.json"),
        );

        if (!fs.existsSync(coverageFinalPath)) {
            writeStderr(
                `Coverage warning skipped: no coverage report found at ${path.relative(
                    workspacePath,
                    coverageFinalPath,
                )}`,
            );
            return;
        }

        const changedLinesByFilePath = getChangedLinesByFilePath({
            baseRef,
            pathFilters: args.pathFilters,
            sourceFileType: args.sourceFileType,
            workspacePath,
        });

        if (changedLinesByFilePath.size === 0) {
            return;
        }

        const coverageMap = libCoverage.createCoverageMap(
            JSON.parse(fs.readFileSync(coverageFinalPath, "utf8")),
        );

        const report = getUncoveredChangedLineReport({
            changedLinesByFilePath,
            coverageMap,
        });

        if (report.entries.length === 0 && report.missingCoverageEntries.length === 0) {
            return;
        }

        writeStderr(`${lightBlue("WARNING:")} changed lines are not covered by unit tests:`);
        for (const entry of report.entries.slice(0, args.maxEntries)) {
            writeLineReportEntry({
                entry,
                expandLines: args.expandLines,
                maxLineRanges: args.maxLineRanges,
            });
        }

        if (report.entries.length > args.maxEntries) {
            writeStderr(`  ...and ${report.entries.length - args.maxEntries} more file(s)`);
        }

        for (const entry of report.missingCoverageEntries.slice(0, args.maxEntries)) {
            writeLineReportEntry({
                entry,
                expandLines: args.expandLines,
                maxLineRanges: args.maxLineRanges,
                suffix: " no coverage data",
            });
        }

        if (report.missingCoverageEntries.length > args.maxEntries) {
            writeStderr(
                `  ...and ${report.missingCoverageEntries.length - args.maxEntries} more file(s) with no coverage data`,
            );
        }
    } catch (error) {
        writeStderr(error instanceof Error ? error.stack || error.message : String(error));
        process.exitCode = 1;
    }
}

/**
 * Reads and validates CLI options for changed-line coverage reporting.
 */
function readArgs(argv) {
    const args = yargs(argv)
        .scriptName("report_uncovered_lines")
        .usage("$0 [options] -- [path...]")
        .option("base", {
            default: "main",
            describe: "Git ref to diff against.",
            type: "string",
        })
        .option("coverage-final", {
            describe:
                "Path to coverage-final.json. Defaults to admin/coverage/test/coverage-final.json.",
            type: "string",
        })
        .option("expand-lines", {
            default: false,
            describe: "Print one warning line per uncovered source line.",
            type: "boolean",
        })
        .option("max-entries", {
            default: 40,
            describe: "Maximum number of files to print per warning group.",
            type: "number",
        })
        .option("max-line-ranges", {
            default: 20,
            describe: "Maximum number of compact line ranges to print per file.",
            type: "number",
        })
        .option("source-file-type", {
            choices: ["all", "typescript"],
            default: "all",
            describe: "Source file extension set to report.",
            type: "string",
        })
        .option("workspace", {
            coerce: value => path.resolve(value),
            describe: "Repository root. Defaults to git rev-parse --show-toplevel.",
            type: "string",
        })
        .parserConfiguration({"populate--": true})
        .check(parsedArgs => {
            if (parsedArgs._.length > 0) {
                throw new Error("Path filters must be passed after --.");
            }
            if (!Number.isInteger(parsedArgs.maxEntries) || parsedArgs.maxEntries < 1) {
                throw new Error("--max-entries must be a positive integer");
            }
            if (!Number.isInteger(parsedArgs.maxLineRanges) || parsedArgs.maxLineRanges < 1) {
                throw new Error("--max-line-ranges must be a positive integer");
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
        baseRef: args.base,
        coverageFinalPath: args.coverageFinal,
        expandLines: args.expandLines,
        maxEntries: args.maxEntries,
        maxLineRanges: args.maxLineRanges,
        pathFilters: (args["--"] ?? []).map(String),
        sourceFileType: args.sourceFileType,
        workspacePath: args.workspace,
    };
}

/**
 * Reads the diff that `dev test` is validating and returns every changed line in
 * source files.
 */
function getChangedLinesByFilePath({baseRef, pathFilters, sourceFileType, workspacePath}) {
    // `--unified=0` keeps the diff small and lets hunk headers describe only the added
    // line ranges. Deleted lines cannot be covered by new tests, so `--diff-filter=AM`
    // limits the report to added and modified files.
    const diffArgs = [
        "diff",
        "--unified=0",
        "--no-ext-diff",
        "--diff-filter=AM",
        baseRef,
        "--",
        ...pathFilters,
    ];
    const diff = runGit(diffArgs, {cwd: workspacePath});
    const changedLinesByFilePath = new Map();
    let filePath = null;

    for (const line of diff.split("\n")) {
        if (line.startsWith("+++ b/")) {
            filePath = line.slice("+++ b/".length);
            if (!isReportSourceFile({filePath, sourceFileType})) {
                filePath = null;
            }
            continue;
        }

        if (!filePath || !line.startsWith("@@ ")) {
            continue;
        }

        const match = /\+(\d+)(?:,(\d+))?/.exec(line);
        if (!match) {
            continue;
        }

        const startLine = Number(match[1]);
        const lineCount = match[2] ? Number(match[2]) : 1;
        if (lineCount === 0) {
            continue;
        }

        let changedLines = changedLinesByFilePath.get(filePath);
        if (!changedLines) {
            changedLines = new Set();
            changedLinesByFilePath.set(filePath, changedLines);
        }
        for (let offset = 0; offset < lineCount; offset++) {
            changedLines.add(startLine + offset);
        }
    }

    return changedLinesByFilePath;
}

function isReportSourceFile({filePath, sourceFileType}) {
    switch (sourceFileType) {
        case "all":
            return isCoverageSourceFile(filePath);
        case "typescript":
            return isTypeScriptCoverageSourceFile(filePath);
        default:
            throw new Error(`Unknown source file type: ${sourceFileType}`);
    }
}

/**
 * Returns uncovered changed lines, split between files with coverage data and
 * changed source files that never appeared in the coverage map.
 */
function getUncoveredChangedLineReport({changedLinesByFilePath, coverageMap}) {
    const coverageFilePaths = new Set(coverageMap.files());
    const entries = [];
    const missingCoverageEntries = [];

    for (const [filePath, changedLines] of Array.from(changedLinesByFilePath).sort(([a], [b]) =>
        a.localeCompare(b),
    )) {
        if (!coverageFilePaths.has(filePath)) {
            // Missing coverage data usually means no test loaded the file at all. Keep that
            // separate from executable lines that were loaded but missed.
            missingCoverageEntries.push({
                filePath,
                lines: Array.from(changedLines).sort((a, b) => a - b),
            });
            continue;
        }

        const lineHitCounts = getExecutableLineHitCounts(coverageMap.fileCoverageFor(filePath));
        const uncoveredLines = Array.from(changedLines)
            .filter(line => lineHitCounts.has(line) && lineHitCounts.get(line) === 0)
            .sort((a, b) => a - b);
        if (uncoveredLines.length > 0) {
            entries.push({filePath, lines: uncoveredLines});
        }
    }

    return {entries, missingCoverageEntries};
}

/**
 * Writes one file's warning. `dev test` keeps ranges compact, while
 * `dev coverage --changed-lines-only` expands them so agents can work line by
 * line.
 */
function writeLineReportEntry({entry, expandLines, maxLineRanges, suffix = ""}) {
    if (expandLines) {
        for (const line of entry.lines) {
            writeStderr(`  ${entry.filePath}:${line}${suffix}`);
        }
        return;
    }

    writeStderr(
        `  ${entry.filePath}:${formatLineRanges(entry.lines, {
            maxLineRanges,
        })}${suffix}`,
    );
}

/**
 * Converts Istanbul statement coverage into per-line hit counts.
 *
 * Istanbul tracks statements and their source ranges. The coverage warning needs
 * line-level answers, so each line in a statement range receives the statement's
 * hit count. If multiple statements touch the same line, the line is considered
 * covered when any statement on it ran.
 */
function getExecutableLineHitCounts(fileCoverage) {
    const fileCoverageJson = fileCoverage.toJSON();
    const lineHitCounts = new Map();

    for (const [statementId, location] of Object.entries(fileCoverageJson.statementMap)) {
        const hitCount = fileCoverageJson.s[statementId] ?? 0;
        for (let line = location.start.line; line <= location.end.line; line++) {
            lineHitCounts.set(line, Math.max(lineHitCounts.get(line) ?? 0, hitCount));
        }
    }

    return lineHitCounts;
}

/**
 * Formats sorted line numbers into compact human-readable ranges.
 */
function formatLineRanges(lines, {maxLineRanges}) {
    const ranges = [];
    let rangeStart = null;
    let previousLine = null;

    for (const line of lines) {
        if (rangeStart === null) {
            rangeStart = line;
            previousLine = line;
            continue;
        }

        if (line === previousLine + 1) {
            previousLine = line;
            continue;
        }

        ranges.push(formatLineRange({end: previousLine, start: rangeStart}));
        rangeStart = line;
        previousLine = line;
    }

    if (rangeStart !== null) {
        ranges.push(formatLineRange({end: previousLine, start: rangeStart}));
    }

    if (ranges.length <= maxLineRanges) {
        return ranges.join(",");
    }

    return `${ranges.slice(0, maxLineRanges).join(",")},... (${ranges.length - maxLineRanges} more range(s))`;
}

function formatLineRange({end, start}) {
    return start === end ? String(start) : `${start}-${end}`;
}

function lightBlue(value) {
    return `\u001B[94m${value}\u001B[0m`;
}

function getWorkspacePath() {
    return runGit(["rev-parse", "--show-toplevel"], {cwd: process.cwd()});
}

function runGit(args, {cwd}) {
    const result = childProcess.spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
        throw new Error(
            `git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`,
        );
    }
    return result.stdout.trim();
}

function writeStderr(value) {
    process.stderr.write(`${value}\n`);
}
