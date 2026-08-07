/* eslint-disable no-console */

import glob from "fast-glob";
import fs from "fs/promises";
import looksSame from "looks-same";
import os from "os";
import {dirname, join as joinPath} from "path";
import {screenshotTestLooksSameTolerance} from "~/app/screenshot_tests/helpers/screenshot_test_looks_same_tolerance.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

const githubOwner = "cyberworlds";
const githubRepo = "cyberworlds";

// The legacy CI pipeline uploads a single `bazel_screenshot_testlogs` artifact.
// The split-runner pipeline shards screenshot tests across runners and uploads one
// `bazel_screenshot_{N}_testlogs` artifact per shard that produced testlogs
// (shards whose screenshots all matched upload nothing). Match both so the sync
// works against either pipeline.
const artifactNamePattern = /^bazel_screenshot(?:_\d+)?_testlogs$/;

type ScreenshotSyncCounts = {
    foundCount: number;
    copiedCount: number;
    skippedCount: number;
};

async function main(): Promise<void> {
    await checkGithubCliAuth();

    const pr = await getGithubPullRequest();
    console.log(`Found PR: ${pr.url}`);

    const {artifacts, run} = await getGithubActionsScreenshotTestArtifacts(pr);
    const artifactNames = artifacts.map(artifact => artifact.name);
    console.log(`Downloading \`${artifactNames.join("`, `")}\` from: ${run.url}`);

    await withTemporaryDirectory(
        os.tmpdir(),
        "cyberworlds_screenshot_tests_sync_",
        async temporaryDirectoryPath => {
            // Download each artifact into its own directory so sharded artifacts can't
            // overwrite each other's files.
            await runAllPromises(
                artifacts.map(artifact =>
                    downloadGithubActionsRunArtifact({
                        run,
                        artifactName: artifact.name,
                        downloadDirectoryPath: joinPath(temporaryDirectoryPath, artifact.name),
                    }),
                ),
            );

            const {foundCount, copiedCount} =
                await syncScreenshotsFromBazelTestlogs(temporaryDirectoryPath);

            if (foundCount === 0) {
                throw new FailedPreconditionError(
                    quote`No screenshots found in \`${artifactNames.join("`, `")}\``,
                );
            }

            console.log(`Synced ${copiedCount} screenshot${copiedCount === 1 ? "" : "s"}`);
        },
    );
}

async function checkGithubCliAuth(): Promise<void> {
    try {
        await runGh(["auth", "status"]);
    } catch {
        throw new FailedPreconditionError(
            "GitHub CLI (`gh`) is not installed or not authenticated (install: `https://cli.github.com`, authenticate: `gh auth login`)",
        );
    }
}

function runGh(args: Array<string>): Promise<string> {
    return runProcess("gh", args, {
        // Pass HOME so `gh` can find its auth config.
        env: {HOME: process.env.HOME},
    });
}

type GithubPullRequest = {
    number: number;
    headRefName: string;
    headRefOid: string;
    url: string;
};

async function getGithubPullRequest(): Promise<GithubPullRequest> {
    const output = await runGh(["pr", "view", "--json", "number,headRefName,headRefOid,url"]);
    return JSON.parse(output);
}

async function getGithubActionsScreenshotTestArtifacts(
    pr: GithubPullRequest,
): Promise<{artifacts: Array<GithubActionsRunArtifact>; run: GithubActionsRun}> {
    const runs = await listGithubActionsRunsForBranch(pr.headRefName);

    if (runs.length === 0) {
        throw new FailedPreconditionError(
            quote`No GitHub Actions runs found for branch ${pr.headRefName}.`,
        );
    }

    // Only consider runs for the PR's current head commit. Artifacts from runs of
    // older commits were rendered from stale code and must never be synced.
    const headRuns = runs.filter(run => run.headSha === pr.headRefOid);

    if (headRuns.length === 0) {
        throw new FailedPreconditionError(
            quote`No GitHub Actions runs found for the PR\u2019s head commit (${pr.headRefOid}). If you just pushed, CI may not have started yet.`,
        );
    }

    for (const run of headRuns) {
        // Screenshot artifacts upload per job, so we only need the screenshot test jobs to
        // be complete — not the whole run (e.g. integration tests may still be going). If
        // a screenshot job is still running its artifact may not exist yet, so tell the
        // caller to retry instead of failing with a confusing "no artifact" error.
        const jobs = await listGithubActionsRunJobs(run.databaseId);
        const incompleteScreenshotJobs = jobs.filter(
            job => job.name.startsWith("Screenshot tests") && job.status !== "completed",
        );
        if (incompleteScreenshotJobs.length > 0) {
            throw new FailedPreconditionError(
                quote`Screenshot test jobs are still running for the PR\u2019s head commit: ${run.url}. Try again once they finish.`,
            );
        }

        const artifacts = (await listGithubActionsRunArtifacts(run.databaseId)).filter(artifact =>
            artifactNamePattern.test(artifact.name),
        );

        if (artifacts.length === 0) continue;

        const unexpiredArtifacts = artifacts.filter(artifact => !artifact.expired);

        if (unexpiredArtifacts.length === 0) {
            throw new FailedPreconditionError(
                quote`Found ${artifacts.map(artifact => artifact.name).join(", ")}, but the artifacts have expired`,
            );
        }

        return {artifacts: unexpiredArtifacts, run};
    }

    throw new FailedPreconditionError(
        quote`No screenshot testlogs artifacts found in recent GitHub Actions runs for ${pr.headRefName}. If all screenshot tests passed there are no new screenshots to sync.`,
    );
}

type GithubActionsRun = {
    databaseId: number;
    headSha: string;
    status: string;
    conclusion: string | null;
    createdAt: string;
    displayTitle: string;
    name: string;
    url: string;
};

async function listGithubActionsRunsForBranch(branch: string): Promise<Array<GithubActionsRun>> {
    const output = await runGh([
        "run",
        "list",
        "--repo",
        `${githubOwner}/${githubRepo}`,
        "--branch",
        branch,
        "--limit",
        "50",
        "--json",
        "databaseId,headSha,status,conclusion,createdAt,displayTitle,name,url",
    ]);
    return JSON.parse(output);
}

type GithubActionsRunArtifact = {
    id: number;
    name: string;
    expired: boolean;
    archive_download_url: string;
};

async function listGithubActionsRunArtifacts(
    runId: number,
): Promise<Array<GithubActionsRunArtifact>> {
    const output = await runGh([
        "api",
        `/repos/${githubOwner}/${githubRepo}/actions/runs/${runId}/artifacts?per_page=100`,
    ]);
    return JSON.parse(output).artifacts;
}

type GithubActionsRunJob = {
    name: string;
    status: string;
    conclusion: string | null;
};

async function listGithubActionsRunJobs(runId: number): Promise<Array<GithubActionsRunJob>> {
    const output = await runGh([
        "api",
        `/repos/${githubOwner}/${githubRepo}/actions/runs/${runId}/jobs?per_page=100`,
    ]);
    return JSON.parse(output).jobs;
}

async function downloadGithubActionsRunArtifact({
    run,
    artifactName,
    downloadDirectoryPath,
}: {
    run: GithubActionsRun;
    artifactName: string;
    downloadDirectoryPath: string;
}): Promise<void> {
    await runGh([
        "run",
        "download",
        String(run.databaseId),
        "--repo",
        `${githubOwner}/${githubRepo}`,
        "--name",
        artifactName,
        "--dir",
        downloadDirectoryPath,
    ]);
}

async function syncScreenshotsFromBazelTestlogs(
    directoryPath: string,
): Promise<ScreenshotSyncCounts> {
    const workspacePath = getWorkspacePath();

    // Each artifact was downloaded into its own subdirectory, hence the leading `*`.
    const outputZipPaths = await glob(
        joinPath(directoryPath, "*/app/screenshot_tests/*_test/test.outputs/outputs.zip"),
    );

    const counts: ScreenshotSyncCounts = {foundCount: 0, copiedCount: 0, skippedCount: 0};

    if (outputZipPaths.length === 0) {
        throw new FailedPreconditionError(quote`No \`outputs.zip\` files found`);
    }

    await runAllPromises(
        outputZipPaths.map(async outputZipPath => {
            const match = assertExists(outputZipPath.match(/\/([a-z0-9_]+)_screenshot_test\//));
            const testName = match[1]!;

            const unzipDirectoryPath = dirname(outputZipPath);
            const actualDirectoryPath = joinPath(unzipDirectoryPath, "actual");

            await runProcess("unzip", ["-q", "-o", outputZipPath, "-d", unzipDirectoryPath]);

            await syncScreenshotsFromBazelTestlogsForTest({
                workspacePath,
                testName,
                actualDirectoryPath,
                counts,
            });
        }),
    );

    return counts;
}

async function syncScreenshotsFromBazelTestlogsForTest({
    workspacePath,
    testName,
    actualDirectoryPath,
    counts,
}: {
    workspacePath: string;
    testName: string;
    actualDirectoryPath: string;
    counts: ScreenshotSyncCounts;
}) {
    const actualDirectoryEntries = await fs.readdir(actualDirectoryPath, {withFileTypes: true});

    await runAllPromises(
        actualDirectoryEntries.map(async actualDirectoryEntry => {
            if (!actualDirectoryEntry.isFile()) return;

            counts.foundCount++;

            const actualFileName = actualDirectoryEntry.name;
            const actualPath = joinPath(actualDirectoryPath, actualFileName);
            const destinationDirectoryPath = joinPath(
                workspacePath,
                "app/screenshot_tests/screenshots",
                testName,
            );
            const destinationPath = joinPath(destinationDirectoryPath, actualFileName);

            await fs.mkdir(destinationDirectoryPath, {recursive: true});

            if (await shouldCopyScreenshot({actualPath, destinationPath})) {
                await fs.copyFile(actualPath, destinationPath);
                counts.copiedCount++;
            } else {
                counts.skippedCount++;
            }
        }),
    );
}

async function shouldCopyScreenshot({
    actualPath,
    destinationPath,
}: {
    actualPath: string;
    destinationPath: string;
}): Promise<boolean> {
    if (!(await pathExists(destinationPath))) return true;

    const result = await looksSame(actualPath, destinationPath, {
        tolerance: screenshotTestLooksSameTolerance,
    });
    return !result.equal;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
