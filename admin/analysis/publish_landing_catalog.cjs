#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yargs = require("yargs/yargs");

const analysisRemote = "https://github.com/cyberworlds/cyberworlds-analysis.git";
const defaultMaxAgeDays = 30;
const defaultRemoteBranch = "main";
const defaultSitePath = path.join("admin", "analysis", "site");
const maxPublishAttempts = 5;

main();

/**
 * Removes expired analysis branches and publishes their searchable catalog.
 */
function main() {
    try {
        const args = readArgs(process.argv.slice(2));
        const workspacePath = args.workspace ?? getWorkspacePath();
        const remote = resolveRemote(args.remote, workspacePath);
        const sitePath = path.resolve(workspacePath, args.site);
        const now = new Date(args.now ?? Date.now());
        if (!Number.isFinite(now.getTime())) throw new Error(`Invalid --now value: ${args.now}`);

        let lastError;
        for (let attempt = 1; attempt <= maxPublishAttempts; attempt++) {
            try {
                const result = publishCatalogAttempt({
                    maxAgeDays: args.maxAgeDays,
                    message: args.message,
                    now,
                    remote,
                    remoteBranch: args.remoteBranch,
                    sitePath,
                    workspacePath,
                });
                process.stdout.write(
                    `Landing catalog published with ${result.branchCount} branches; removed ${result.removedBranches.length} stale branches.\n`,
                );
                for (const branchName of result.removedBranches) {
                    process.stdout.write(`Removed stale analysis branch: ${branchName}\n`);
                }
                return;
            } catch (error) {
                lastError = error;
                if (attempt < maxPublishAttempts) {
                    process.stderr.write(
                        `Landing catalog publish attempt ${attempt} raced or failed; retrying.\n`,
                    );
                }
            }
        }
        throw lastError;
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
        );
        process.exitCode = 1;
    }
}

function readArgs(argv) {
    return yargs(argv)
        .scriptName("publish_landing_catalog")
        .usage("$0 [options]")
        .option("max-age-days", {
            default: defaultMaxAgeDays,
            describe: "Delete non-production analysis branches older than this many days.",
            type: "number",
        })
        .option("message", {
            default: "Update Landing branch catalog",
            describe: "Commit message for the generated catalog update.",
            type: "string",
        })
        .option("now", {
            describe: "Current ISO timestamp override, useful for deterministic tests.",
            type: "string",
        })
        .option("remote", {
            default: analysisRemote,
            describe: "Analysis repository remote name or URL.",
            type: "string",
        })
        .option("remote-branch", {
            default: defaultRemoteBranch,
            describe: "Production branch containing the Landing catalog.",
            type: "string",
        })
        .option("site", {
            default: defaultSitePath,
            describe: "Static analysis site source directory.",
            type: "string",
        })
        .option("workspace", {
            coerce: value => path.resolve(value),
            describe: "Repository root. Defaults to git rev-parse --show-toplevel.",
            type: "string",
        })
        .check(args => {
            if (!Number.isFinite(args.maxAgeDays) || args.maxAgeDays <= 0) {
                throw new Error("--max-age-days must be a positive number");
            }
            return true;
        })
        .help()
        .strict()
        .parseSync();
}

function getWorkspacePath() {
    return runGit(["rev-parse", "--show-toplevel"], {cwd: process.cwd()});
}

function resolveRemote(remote, workspacePath) {
    const result = childProcess.spawnSync("git", ["remote", "get-url", remote], {
        cwd: workspacePath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
    });
    return result.status === 0 ? result.stdout.trim() : remote;
}

function publishCatalogAttempt({
    maxAgeDays,
    message,
    now,
    remote,
    remoteBranch,
    sitePath,
    workspacePath,
}) {
    const catalogTemplatePath = path.join(sitePath, "index.html");
    if (!fs.existsSync(catalogTemplatePath)) {
        throw new Error(`Landing catalog template does not exist: ${catalogTemplatePath}`);
    }

    const checkoutParentPath = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-catalog-"));
    const checkoutPath = path.join(checkoutParentPath, "repository");
    try {
        runGit(["clone", "--quiet", "--no-checkout", remote, checkoutPath], {
            cwd: workspacePath,
        });
        runGit(["fetch", "--quiet", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"], {
            cwd: checkoutPath,
        });

        const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);
        const branches = [];
        const removedBranches = [];
        for (const remoteRef of listRemoteRefs(checkoutPath)) {
            const metadata = readBranchMetadata({checkoutPath, remoteRef});
            const updatedAt =
                metadata?.updatedAt ??
                runGit(["show", "--no-patch", "--format=%cI", remoteRef.commit], {
                    cwd: checkoutPath,
                });
            if (remoteRef.name !== remoteBranch && new Date(updatedAt) < cutoff) {
                assertBranchName(remoteRef.name, checkoutPath);
                runGit(["push", "--quiet", "origin", "--delete", remoteRef.name], {
                    cwd: checkoutPath,
                });
                removedBranches.push(metadata?.name ?? remoteRef.name);
                continue;
            }
            if (metadata === null || remoteRef.name === remoteBranch) continue;
            branches.push({
                name: metadata.name,
                url: `${metadata.deployUrl.replace(/\/+$/u, "")}/`,
                lastUpdate: metadata.updatedAt,
            });
        }

        branches.sort((left, right) => {
            return (
                right.lastUpdate.localeCompare(left.lastUpdate) ||
                left.name.localeCompare(right.name)
            );
        });

        runGit(["checkout", "--quiet", "-B", remoteBranch, `origin/${remoteBranch}`], {
            cwd: checkoutPath,
        });
        // Each branch job pulls main immediately before writing and pushes immediately
        // afterward to minimize the race window. Two jobs can still race after the pull;
        // that small chance is acceptable because this is an internal tool and the next
        // branch publish reconstructs the complete catalog from the deploy branches.
        runGit(["pull", "--quiet", "--ff-only", "origin", remoteBranch], {
            cwd: checkoutPath,
        });
        fs.copyFileSync(catalogTemplatePath, path.join(checkoutPath, "index.html"));
        fs.writeFileSync(
            path.join(checkoutPath, "branches.json"),
            `${JSON.stringify(branches, null, 2)}\n`,
        );

        runGit(["add", "index.html", "branches.json"], {cwd: checkoutPath});
        if (gitHasStagedChanges(checkoutPath)) {
            runGit(["commit", "--quiet", "-m", message], {
                cwd: checkoutPath,
                env: gitIdentityEnvironment(),
            });
            runGit(["push", "--quiet", "origin", `HEAD:refs/heads/${remoteBranch}`], {
                cwd: checkoutPath,
            });
        }

        return {branchCount: branches.length, removedBranches};
    } finally {
        fs.rmSync(checkoutParentPath, {force: true, recursive: true});
    }
}

function listRemoteRefs(checkoutPath) {
    const output = runGit(
        ["for-each-ref", "--format=%(refname:strip=3)%09%(objectname)", "refs/remotes/origin"],
        {cwd: checkoutPath},
    );
    if (!output) return [];
    return output
        .split("\n")
        .map(line => {
            const [name, commit] = line.split("\t");
            return {name, commit};
        })
        .filter(({name}) => name && name !== "HEAD");
}

function readBranchMetadata({checkoutPath, remoteRef}) {
    const result = childProcess.spawnSync("git", ["show", `${remoteRef.commit}:branch.json`], {
        cwd: checkoutPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) return null;

    let metadata;
    try {
        metadata = JSON.parse(result.stdout);
    } catch {
        throw new Error(`Invalid branch metadata on ${remoteRef.name}`);
    }
    if (
        typeof metadata !== "object" ||
        metadata === null ||
        typeof metadata.name !== "string" ||
        metadata.deployBranch !== remoteRef.name ||
        typeof metadata.deployUrl !== "string" ||
        !metadata.deployUrl.startsWith("https://") ||
        typeof metadata.sourceCommit !== "string" ||
        typeof metadata.updatedAt !== "string" ||
        !Number.isFinite(new Date(metadata.updatedAt).getTime())
    ) {
        throw new Error(`Unexpected branch metadata on ${remoteRef.name}`);
    }
    return metadata;
}

function assertBranchName(branchName, workspacePath) {
    runGit(["check-ref-format", `refs/heads/${branchName}`], {cwd: workspacePath});
}

function gitHasStagedChanges(checkoutPath) {
    const result = childProcess.spawnSync("git", ["diff", "--cached", "--quiet"], {
        cwd: checkoutPath,
        stdio: "ignore",
    });
    if (result.status === 0) return false;
    if (result.status === 1) return true;
    throw new Error("Failed to inspect staged Landing catalog changes");
}

function gitIdentityEnvironment() {
    return {
        ...process.env,
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "analysis@alpine.inc",
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Alpine Analysis",
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "analysis@alpine.inc",
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Alpine Analysis",
    };
}

function runGit(args, {cwd, env = process.env} = {}) {
    const result = childProcess.spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
    }
    return result.stdout.trim();
}
