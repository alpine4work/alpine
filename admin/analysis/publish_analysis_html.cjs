#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yargs = require("yargs/yargs");

const analysisRemote = "https://github.com/cyberworlds/cyberworlds-analysis.git";
const analysisRemoteBranchName = "main";
const defaultCoverageReportPath = path.join("admin", "coverage", "all");
const defaultSitePath = path.join("admin", "analysis", "site");
const excludedCoverageReportDeployFiles = new Set(["coverage-final.json", "lcov.info"]);
const siteName = "analysis";

main();

/**
 * Builds the static analysis site and optionally publishes a deploy commit.
 */
function main() {
    try {
        const args = readArgs(process.argv.slice(2));
        const workspacePath = args.workspace ?? getWorkspacePath();
        const outputPath = path.resolve(
            workspacePath,
            args.output ?? path.join("admin", "analysis", "html"),
        );
        const remote = args.remote ?? analysisRemote;
        const remoteBranchName = args.remoteBranch ?? analysisRemoteBranchName;
        const sitePath = path.resolve(workspacePath, args.site ?? defaultSitePath);
        const coverageReportPath = path.resolve(
            workspacePath,
            args.coverage ?? defaultCoverageReportPath,
        );
        const updateBranch = args.push && !args.noBranch;

        assertSafeOutputPath({coverageReportPath, outputPath, sitePath, workspacePath});
        assertBranchName(remoteBranchName, workspacePath);

        writeAnalysisSite({coverageReportPath, outputPath, sitePath});

        writeStdout(`Analysis site written to: ${outputPath}`);
        writeStdout(`HTML: ${path.join(outputPath, "index.html")}`);
        writeStdout(`Coverage HTML: ${path.join(outputPath, "coverage", "index.html")}`);

        if (updateBranch) {
            const commit = createAnalysisCommit({
                message:
                    args.message ?? `Update ${siteName} site from ${shortGitSha(workspacePath)}`,
                outputPath,
                workspacePath,
            });
            writeStdout(`Created deploy commit: ${commit.slice(0, 12)}`);

            if (args.push) {
                pushAnalysisBranch({commit, remote, remoteBranchName, workspacePath});
                writeStdout(`Pushed branch: ${remote}/${remoteBranchName}`);
            }
        }
    } catch (error) {
        writeStderr(error instanceof Error ? error.stack || error.message : String(error));
        process.exitCode = 1;
    }
}

/**
 * Reads and validates the CLI options for publishing analysis HTML.
 */
function readArgs(argv) {
    return yargs(argv)
        .scriptName("publish_analysis_html")
        .usage("$0 [options]")
        .parserConfiguration({"boolean-negation": false})
        .option("coverage", {
            describe: `Coverage report directory to publish under /coverage. Defaults to ${defaultCoverageReportPath}.`,
            type: "string",
        })
        .option("message", {
            describe: "Commit message for the generated deploy commit.",
            type: "string",
        })
        .option("no-branch", {
            default: false,
            describe: "Only write the generated site files.",
            type: "boolean",
        })
        .option("output", {
            describe: "Generated site directory. Defaults to admin/analysis/html.",
            type: "string",
        })
        .option("push", {
            default: false,
            describe: "Push the generated deploy commit to the analysis remote.",
            type: "boolean",
        })
        .option("remote", {
            default: analysisRemote,
            describe: "Remote name or URL to push.",
            type: "string",
        })
        .option("remote-branch", {
            alias: "branch",
            default: analysisRemoteBranchName,
            describe: "Remote branch to update.",
            type: "string",
        })
        .option("site", {
            default: defaultSitePath,
            describe: "Source site directory.",
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
 * Finds the repository root for local invocations.
 */
function getWorkspacePath() {
    return runGit(["rev-parse", "--show-toplevel"], {cwd: process.cwd()});
}

/**
 * Refuses output paths that would make the publish step delete source inputs.
 */
function assertSafeOutputPath({coverageReportPath, outputPath, sitePath, workspacePath}) {
    const resolvedCoverageReportPath = path.resolve(coverageReportPath);
    const resolvedOutputPath = path.resolve(outputPath);
    const resolvedSitePath = path.resolve(sitePath);
    const resolvedWorkspacePath = path.resolve(workspacePath);
    if (resolvedOutputPath === path.parse(resolvedOutputPath).root) {
        throw new Error(`Refusing to clear filesystem root: ${outputPath}`);
    }
    if (resolvedOutputPath === resolvedWorkspacePath) {
        throw new Error(`Refusing to clear workspace root: ${outputPath}`);
    }
    if (
        samePathOrChild(resolvedOutputPath, resolvedSitePath) ||
        samePathOrChild(resolvedSitePath, resolvedOutputPath)
    ) {
        throw new Error(
            `Refusing to use overlapping site and output paths: ${sitePath}, ${outputPath}`,
        );
    }
    if (
        samePathOrChild(resolvedOutputPath, resolvedCoverageReportPath) ||
        samePathOrChild(resolvedCoverageReportPath, resolvedOutputPath)
    ) {
        throw new Error(
            `Refusing to use overlapping coverage and output paths: ${coverageReportPath}, ${outputPath}`,
        );
    }
}

/**
 * Validates that the remote branch can be used as a git branch name.
 */
function assertBranchName(branchName, workspacePath) {
    runGit(["check-ref-format", `refs/heads/${branchName}`], {cwd: workspacePath});
}

/**
 * Writes the deployable analysis site into the output directory.
 *
 * The checked-in `site` directory provides the static shell, Netlify config, and
 * auth functions. Generated coverage reports are copied in at publish time so site
 * infrastructure can be updated from this repo without checking out the deploy
 * repo.
 */
function writeAnalysisSite({coverageReportPath, outputPath, sitePath}) {
    if (!fs.existsSync(sitePath)) {
        throw new Error(`Analysis site source directory does not exist: ${sitePath}`);
    }
    if (!fs.existsSync(coverageReportPath)) {
        throw new Error(`Coverage report directory does not exist: ${coverageReportPath}`);
    }
    const coverageIndexPath = path.join(coverageReportPath, "index.html");
    if (!fs.existsSync(coverageIndexPath)) {
        throw new Error(`Coverage report index does not exist: ${coverageIndexPath}`);
    }

    fs.rmSync(outputPath, {force: true, recursive: true});
    fs.mkdirSync(outputPath, {recursive: true});
    fs.cpSync(sitePath, outputPath, {
        force: true,
        recursive: true,
    });
    fs.cpSync(coverageReportPath, path.join(outputPath, "coverage"), {
        filter: sourcePath => {
            const relativePath = path.relative(coverageReportPath, sourcePath);
            return !excludedCoverageReportDeployFiles.has(relativePath);
        },
        force: true,
        recursive: true,
    });
}

/**
 * Checks whether one path is the same as or contained inside another path.
 */
function samePathOrChild(childPath, parentPath) {
    const relativePath = path.relative(parentPath, childPath);
    return (
        relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
}

/**
 * Creates a deploy commit from generated files without checking out a branch.
 *
 * The temporary index and output work tree let CI replace the analysis repo's
 * published contents while leaving the source checkout untouched.
 */
function createAnalysisCommit({message, outputPath, workspacePath}) {
    const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-git-index-"));
    const indexPath = path.join(indexDir, "index");

    const gitDir = runGit(["rev-parse", "--absolute-git-dir"], {cwd: workspacePath});
    const env = {
        ...process.env,
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "analysis@alpine.inc",
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Alpine Analysis",
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "analysis@alpine.inc",
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Alpine Analysis",
        GIT_INDEX_FILE: indexPath,
    };

    try {
        runGitWithWorkTree(["read-tree", "--empty"], {env, gitDir, outputPath});
        runGitWithWorkTree(["add", "-A", "."], {env, gitDir, outputPath});
        const tree = runGitWithWorkTree(["write-tree"], {env, gitDir, outputPath});
        const commit = runGit(["commit-tree", tree, "-m", message], {
            cwd: workspacePath,
            env,
        });
        return commit;
    } finally {
        fs.rmSync(indexDir, {force: true, recursive: true});
    }
}

/**
 * Pushes the generated deploy commit to the analysis repository branch.
 *
 * The branch is intentionally disposable, so each publish replaces the full site
 * contents. `--force-with-lease` keeps that replacement from clobbering a newer
 * remote update.
 */
function pushAnalysisBranch({commit, remote, remoteBranchName, workspacePath}) {
    const remoteCommit = remoteBranchCommit({
        branchName: remoteBranchName,
        remote,
        workspacePath,
    });
    const pushArgs = ["push"];
    if (remoteCommit) {
        pushArgs.push(`--force-with-lease=refs/heads/${remoteBranchName}:${remoteCommit}`);
    }
    pushArgs.push(remote, `${commit}:refs/heads/${remoteBranchName}`);
    runGit(pushArgs, {cwd: workspacePath, stdio: "inherit"});
}

/**
 * Reads the current remote branch commit, if the branch already exists.
 */
function remoteBranchCommit({branchName, remote, workspacePath}) {
    const result = childProcess.spawnSync("git", ["ls-remote", "--heads", remote, branchName], {
        cwd: workspacePath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || "Failed to read remote branch.");
    }

    const [commit] = result.stdout.trim().split(/\s+/u);
    return commit || undefined;
}

/**
 * Reads the short source commit SHA for the default deploy message.
 */
function shortGitSha(workspacePath) {
    return runGit(["rev-parse", "--short", "HEAD"], {cwd: workspacePath});
}

/**
 * Runs a git command and returns trimmed stdout.
 */
function runGit(args, {cwd, env = process.env, stdio = "pipe"} = {}) {
    const result = childProcess.spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        env,
        stdio,
    });
    if (result.status !== 0) {
        const stderr = result.stderr ? result.stderr.trim() : "";
        throw new Error(stderr || `git ${args.join(" ")} failed`);
    }
    return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

/**
 * Runs a git command against the generated output directory as a work tree.
 */
function runGitWithWorkTree(args, {env, gitDir, outputPath}) {
    const result = childProcess.spawnSync(
        "git",
        ["--git-dir", gitDir, "--work-tree", outputPath, ...args],
        {
            cwd: outputPath,
            encoding: "utf8",
            env,
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
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
