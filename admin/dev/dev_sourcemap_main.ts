/* eslint-disable no-console */
import chalk from "chalk";
import fs from "fs-extra";
import {basename, join as joinPath} from "path";
import {SourceMapConsumer} from "source-map";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {isProcessExitErrorWithCode, runProcess} from "~/server/helpers/node/run_process.js";
import {UnknownError} from "~/shared/error/error.js";

const githubOwner = "cyberworlds";
const githubRepo = "cyberworlds";

// Matches Chrome/V8 stack frame lines like: at foo
// (file:///path/to/server-build-bd8r9phg.js:1:2238535) at
// https://resources.alpine.inc/assets/root-efby6jfw.js:42:1234
//
// TODO: Support Safari and Firefox stack trace formats.
const stackFramePattern =
    /(?<prefix>.*?)(?<url>[^\s(]+\.js):(?<line>\d+):(?<column>\d+)(?<suffix>.*)/;

// Rough heuristic: a stack trace has at least two lines that look like stack
// frames or an "Error:" / "at " prefix.
function looksLikeStackTrace(text: string): boolean {
    const lines = text.split("\n");
    let frameCount = 0;
    for (const line of lines) {
        if (stackFramePattern.test(line) || /^\s+at /.test(line)) {
            frameCount++;
        }
    }
    return frameCount >= 2;
}

async function getStackTraceInput(): Promise<string> {
    // If stdin is piped (not a TTY), read from it.
    if (!process.stdin.isTTY) {
        return await readStdin();
    }

    // Not piped. Check clipboard for a stack trace.
    try {
        const clipboard = await runProcess("pbpaste", []);
        if (clipboard.trim() !== "" && looksLikeStackTrace(clipboard)) {
            console.error(chalk.dim("Using stack trace from clipboard.") + "\n");
            return clipboard;
        }
    } catch {
        // pbpaste not available (e.g. Linux). Fall through to prompt.
    }

    // No clipboard stack trace. Prompt the user.
    console.error("Paste a stack trace, then press Ctrl-D:");
    return await readStdin();
}

function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk: string) => {
            data += chunk;
        });
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", reject);
    });
}

async function getDeployedCommitSha(): Promise<string> {
    // eslint-disable-next-line cyberworlds/no-global-fetch
    const response = await fetch("https://alpine.inc/api/internal/deploy");
    const deploy: {ok: true; activeCommitSha: string} | {ok: false} = await response.json();

    if (!deploy.ok) {
        throw new UnknownError("Failed to fetch deployed commit from alpine.inc");
    }

    return deploy.activeCommitSha;
}

async function downloadSourcemaps(commitSha: string): Promise<string | null> {
    const cacheDir = joinPath(devEnvPaths.cache, "sourcemaps", commitSha);
    const completeMarker = joinPath(cacheDir, ".complete");

    if (await fs.pathExists(completeMarker)) {
        return cacheDir;
    }

    await fs.ensureDir(cacheDir);

    try {
        await runProcess(
            "gh",
            [
                "run",
                "download",
                "--repo",
                `${githubOwner}/${githubRepo}`,
                "--name",
                `sourcemaps-${commitSha}`,
                "--dir",
                cacheDir,
            ],
            // Pass HOME so `gh` can find its auth config.
            {env: {HOME: process.env.HOME}},
        );
    } catch (error) {
        if (isProcessExitErrorWithCode(error, 1)) {
            // Artifact not found. Clean up and return null.
            await fs.remove(cacheDir);
            return null;
        }
        throw error;
    }

    await fs.writeFile(completeMarker, "");
    return cacheDir;
}

async function loadSourcemapConsumers(
    sourcemapsDir: string,
): Promise<Map<string, SourceMapConsumer>> {
    const consumers = new Map<string, SourceMapConsumer>();

    try {
        // Support both flat layout (all .map files in root) and nested layout (client/ and
        // server/ subdirs).
        for (const subdir of [".", "client", "server"]) {
            const dirPath = joinPath(sourcemapsDir, subdir);
            if (!(await fs.pathExists(dirPath))) continue;

            const files = await fs.readdir(dirPath);
            for (const file of files) {
                if (!file.endsWith(".map")) continue;

                const mapContent = await fs.readFile(joinPath(dirPath, file), "utf8");
                const consumer = await new SourceMapConsumer(JSON.parse(mapContent));

                // Key by the JS filename (strip .map extension).
                const jsFilename = file.slice(0, -4);
                consumers.set(jsFilename, consumer);
            }
        }
    } catch (error) {
        for (const consumer of consumers.values()) {
            consumer.destroy();
        }
        throw error;
    }

    return consumers;
}

/** Returns the set of JS filenames referenced in stack frames. */
function extractStackTraceFilenames(stackTrace: string): Set<string> {
    const filenames = new Set<string>();
    for (const line of stackTrace.split("\n")) {
        const match = stackFramePattern.exec(line);
        if (match?.groups) {
            filenames.add(basename(match.groups.url!));
        }
    }
    return filenames;
}

function resolveStackTrace(stackTrace: string, consumers: Map<string, SourceMapConsumer>): string {
    const lines = stackTrace.split("\n");
    const resolvedLines: Array<string> = [];

    for (const line of lines) {
        const match = stackFramePattern.exec(line);

        if (!match?.groups) {
            resolvedLines.push(line);
            continue;
        }

        const {prefix, url, suffix} = match.groups;
        const lineNumber = parseInt(match.groups.line!, 10);
        const columnNumber = parseInt(match.groups.column!, 10);
        const filename = basename(url!);

        const consumer = consumers.get(filename);

        if (!consumer) {
            resolvedLines.push(line);
            continue;
        }

        const original = consumer.originalPositionFor({
            line: lineNumber,
            column: columnNumber,
        });

        if (original.source === null) {
            resolvedLines.push(line);
            continue;
        }

        const name = original.name ? ` ${original.name}` : "";
        const source = original.source.replace(/^(\.\.\/)+/, "");
        resolvedLines.push(
            `${prefix}${chalk.cyan(source)}:${chalk.yellow(String(original.line))}:${chalk.yellow(String(original.column))}${name}${suffix}`,
        );
    }

    return resolvedLines.join("\n");
}

async function ensureGhAuthed(): Promise<void> {
    try {
        await runProcess("gh", ["auth", "status"], {env: {HOME: process.env.HOME}});
    } catch {
        throw new UnknownError(
            "GitHub CLI is not installed or not authenticated.\n" +
                "Install: https://cli.github.com\n" +
                "Then run: gh auth login",
        );
    }
}

async function main(): Promise<void> {
    let commitSha: string | undefined;

    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith("--commit=")) {
            commitSha = arg.slice("--commit=".length);
        }
    }

    await ensureGhAuthed();

    const stackTrace = await getStackTraceInput();

    if (stackTrace.trim() === "") {
        throw new UnknownError("No stack trace provided.");
    }

    if (!commitSha) {
        console.error(chalk.dim("Fetching deployed commit..."));
        commitSha = await getDeployedCommitSha();
        console.error(chalk.dim(`Deployed commit: ${commitSha.slice(0, 10)}`));
    }

    const neededFilenames = extractStackTraceFilenames(stackTrace);

    // Try the deploy commit and walk back through ancestors until we find sourcemaps
    // whose chunk hashes match the stack trace.
    const maxAncestors = 5;
    let consumers: Map<string, SourceMapConsumer> | undefined;
    let sha = commitSha;

    for (let i = 0; i < maxAncestors; i++) {
        if (i > 0) {
            console.error(
                chalk.dim(
                    `Sourcemaps for ${sha.slice(0, 10)} don\u2019t match stack trace chunks, trying parent...`,
                ),
            );
            sha = (await runProcess("git", ["rev-parse", `${sha}~1`])).trim();
        }

        console.error(chalk.dim(`Downloading sourcemaps for ${sha.slice(0, 10)}...`));
        const sourcemapsDir = await downloadSourcemaps(sha);

        if (sourcemapsDir === null) {
            continue;
        }

        const candidate = await loadSourcemapConsumers(sourcemapsDir);

        if (candidate.size === 0) {
            continue;
        }

        // Check if any of the stack trace filenames match these sourcemaps.
        let hasMatch = false;
        for (const filename of neededFilenames) {
            if (candidate.has(filename)) {
                hasMatch = true;
                break;
            }
        }

        if (hasMatch) {
            consumers = candidate;
            if (i > 0) {
                console.error(chalk.dim(`Found matching sourcemaps at ${sha.slice(0, 10)}.`));
            }
            break;
        }

        // No match — clean up and try the next ancestor.
        for (const consumer of candidate.values()) {
            consumer.destroy();
        }
    }

    if (!consumers) {
        throw new UnknownError(
            `No sourcemaps matching the stack trace chunks found for ${commitSha.slice(0, 10)} ` +
                `or its ${maxAncestors - 1} ancestors.`,
        );
    }

    console.error();
    console.log(resolveStackTrace(stackTrace, consumers));

    // Clean up wasm resources.
    for (const consumer of consumers.values()) {
        consumer.destroy();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
