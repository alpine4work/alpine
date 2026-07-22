#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yargs = require("yargs/yargs");

const analysisRemote = "https://github.com/cyberworlds/cyberworlds-analysis.git";
const analysisRemoteBranchName = "main";
const branchIndexTemplateName = "branch_index.html";
const defaultCoverageReportPath = path.join("admin", "coverage", "all");
const defaultLandingPath = path.join("admin", "analysis", "landing-html");
const defaultSitePath = path.join("admin", "analysis", "site");
const excludedCoverageReportDeployFiles = new Set(["coverage-final.json", "lcov.info"]);
const siteName = "cyberworlds-analysis";

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
        const sourceBranchName = args.sourceBranch ?? currentGitBranch(workspacePath);
        const netlifySiteName = args.netlifySite;
        const remoteBranchName =
            args.remoteBranch ??
            analysisBranchNameForSourceBranch({
                siteName: netlifySiteName,
                sourceBranchName,
            });
        const sitePath = path.resolve(workspacePath, args.site ?? defaultSitePath);
        const landingPath = args.landing
            ? path.resolve(workspacePath, args.landing)
            : path.resolve(workspacePath, defaultLandingPath);
        const coverageReportPath = path.resolve(
            workspacePath,
            args.coverage ?? defaultCoverageReportPath,
        );
        const updateBranch = args.push && !args.noBranch;

        assertSafeOutputPath({
            coverageReportPath,
            landingPath,
            outputPath,
            sitePath,
            workspacePath,
        });
        assertBranchName(remoteBranchName, workspacePath);

        writeAnalysisSite({
            branch: {
                deployBranch: remoteBranchName,
                deployUrl: netlifyDeployUrl({
                    branchName: remoteBranchName,
                    siteName: netlifySiteName,
                }),
                name: sourceBranchName,
                sourceCommit:
                    args.sourceCommit ?? runGit(["rev-parse", "HEAD"], {cwd: workspacePath}),
                updatedAt: args.updatedAt ?? new Date().toISOString(),
            },
            coverageReportPath,
            landingPath,
            outputPath,
            sitePath,
        });

        writeStdout(`Analysis site written to: ${outputPath}`);
        writeStdout(`HTML: ${path.join(outputPath, "index.html")}`);
        writeStdout(`Coverage HTML: ${path.join(outputPath, "coverage", "index.html")}`);
        writeStdout(`Landing HTML: ${path.join(outputPath, "landing", "index.html")}`);

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
        .option("landing", {
            default: defaultLandingPath,
            describe: "Pre-rendered public Landing directory to publish.",
            type: "string",
        })
        .option("netlify-site", {
            default: siteName,
            describe: "Netlify site name used to construct branch deploy URLs.",
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
            describe: "Remote deploy branch. Defaults to a Netlify-safe source branch name.",
            type: "string",
        })
        .option("site", {
            default: defaultSitePath,
            describe: "Source site directory.",
            type: "string",
        })
        .option("source-branch", {
            describe: "Source repository branch represented by this analysis deploy.",
            type: "string",
        })
        .option("source-commit", {
            describe: "Full source commit SHA represented by this analysis deploy.",
            type: "string",
        })
        .option("updated-at", {
            describe: "ISO timestamp for the deploy metadata. Defaults to the current time.",
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
function assertSafeOutputPath({
    coverageReportPath,
    landingPath,
    outputPath,
    sitePath,
    workspacePath,
}) {
    const resolvedCoverageReportPath = path.resolve(coverageReportPath);
    const resolvedOutputPath = path.resolve(outputPath);
    const resolvedSitePath = path.resolve(sitePath);
    const resolvedLandingPath = path.resolve(landingPath);
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
    if (
        samePathOrChild(resolvedOutputPath, resolvedLandingPath) ||
        samePathOrChild(resolvedLandingPath, resolvedOutputPath)
    ) {
        throw new Error(
            `Refusing to use overlapping Landing and output paths: ${landingPath}, ${outputPath}`,
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
function writeAnalysisSite({branch, coverageReportPath, landingPath, outputPath, sitePath}) {
    if (!fs.existsSync(sitePath)) {
        throw new Error(`Analysis site source directory does not exist: ${sitePath}`);
    }
    if (!fs.existsSync(coverageReportPath)) {
        throw new Error(`Coverage report directory does not exist: ${coverageReportPath}`);
    }
    if (!fs.existsSync(path.join(landingPath, "landing", "index.html"))) {
        throw new Error(`Landing output does not exist: ${landingPath}`);
    }
    const coverageIndexPath = path.join(coverageReportPath, "index.html");
    if (!fs.existsSync(coverageIndexPath)) {
        throw new Error(`Coverage report index does not exist: ${coverageIndexPath}`);
    }

    fs.rmSync(outputPath, {force: true, recursive: true});
    fs.mkdirSync(outputPath, {recursive: true});
    fs.cpSync(landingPath, outputPath, {
        force: true,
        recursive: true,
    });
    fs.cpSync(sitePath, outputPath, {
        filter: sourcePath => {
            const relativePath = path.relative(sitePath, sourcePath);
            return relativePath !== "branches.json" && relativePath !== branchIndexTemplateName;
        },
        force: true,
        recursive: true,
    });
    if (branch.deployBranch !== analysisRemoteBranchName) {
        const branchIndexTemplatePath = path.join(sitePath, branchIndexTemplateName);
        if (!fs.existsSync(branchIndexTemplatePath)) {
            throw new Error(`Branch index template does not exist: ${branchIndexTemplatePath}`);
        }
        fs.copyFileSync(branchIndexTemplatePath, path.join(outputPath, "index.html"));
    }
    fs.cpSync(coverageReportPath, path.join(outputPath, "coverage"), {
        filter: sourcePath => {
            const relativePath = path.relative(coverageReportPath, sourcePath);
            return !excludedCoverageReportDeployFiles.has(relativePath);
        },
        force: true,
        recursive: true,
    });
    fs.writeFileSync(path.join(outputPath, "branch.json"), `${JSON.stringify(branch, null, 2)}\n`);
    if (branch.deployBranch === analysisRemoteBranchName) {
        fs.writeFileSync(path.join(outputPath, "branches.json"), "[]\n");
    }
}

/**
 * Use the source branch verbatim when it is already a valid Netlify DNS label.
 * Otherwise produce a stable label with a hash suffix to avoid collisions such as
 * `feature/foo` and `feature-foo`.
 */
function analysisBranchNameForSourceBranch({siteName, sourceBranchName}) {
    if (sourceBranchName === analysisRemoteBranchName) return sourceBranchName;
    const maximumBranchLength = 63 - siteName.length - "--".length;
    const hashLength = 8;
    const suffixLength = hashLength + "-".length;
    if (maximumBranchLength <= suffixLength) {
        throw new Error(`Netlify site name is too long for branch deploys: ${siteName}`);
    }
    if (
        sourceBranchName.length <= maximumBranchLength &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(sourceBranchName)
    ) {
        return sourceBranchName;
    }

    const hash = crypto
        .createHash("sha256")
        .update(sourceBranchName)
        .digest("hex")
        .slice(0, hashLength);
    const normalized =
        sourceBranchName
            .toLowerCase()
            .replace(/[^a-z0-9-]+/gu, "-")
            .replace(/-+/gu, "-")
            .replace(/^-|-$/gu, "") || "branch";
    const prefix = normalized.slice(0, maximumBranchLength - suffixLength).replace(/-$/u, "");
    return `${prefix}-${hash}`;
}

function netlifyDeployUrl({branchName, siteName}) {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(siteName) || siteName.length > 63) {
        throw new Error(`Invalid Netlify site name: ${siteName}`);
    }
    if (branchName === analysisRemoteBranchName) return `https://${siteName}.netlify.app`;

    const deploySubdomain = `${branchName}--${siteName}`;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(branchName)) {
        throw new Error(`Invalid Netlify branch deploy name: ${branchName}`);
    }
    if (deploySubdomain.length > 63) {
        throw new Error(`Netlify branch deploy name is too long: ${deploySubdomain}`);
    }
    return `https://${deploySubdomain}.netlify.app`;
}

function currentGitBranch(workspacePath) {
    const branchName = runGit(["branch", "--show-current"], {cwd: workspacePath});
    if (branchName) return branchName;
    if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
    throw new Error("Could not determine the source branch; pass --source-branch");
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
