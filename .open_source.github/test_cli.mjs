import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const scriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const repositoryPath = resolve(scriptDirectoryPath, "..");
const cliTestAlpineApiKey = process.env.CLI_TEST_ALPINE_API_KEY;
const githubRepository = process.env.GITHUB_REPOSITORY;
const githubRunId = process.env.GITHUB_RUN_ID;
const githubRunAttempt = process.env.GITHUB_RUN_ATTEMPT;

assert.ok(cliTestAlpineApiKey, "CLI_TEST_ALPINE_API_KEY must be set to run the CLI test.");
assert.ok(githubRepository, "GITHUB_REPOSITORY must be set to run the CLI test.");
assert.ok(githubRunId, "GITHUB_RUN_ID must be set to run the CLI test.");
assert.ok(githubRunAttempt, "GITHUB_RUN_ATTEMPT must be set to run the CLI test.");
assert.ok(process.env.npm_execpath, "npm must run the CLI test.");

const dataDirectoryPath = await mkdtemp(join(tmpdir(), "alpine-cli-integration-"));
const apiDataDirectoryPath = await mkdtemp(join(tmpdir(), "alpine-cli-api-integration-"));
const cliArchiveDirectoryPath = await mkdtemp(join(tmpdir(), "alpine-cli-archive-"));
const cliInstallationDirectoryPath = await mkdtemp(join(tmpdir(), "alpine-cli-installation-"));
const tracerServer = await createTracerServer();
let cliPath;

try {
    cliPath = await installCli();

    // Discovery commands do not need the API, but the CLI initializes its authenticated session
    // before dispatching every command. A future expiration keeps this test fully offline.
    await writeFile(
        join(dataDirectoryPath, "auth.json"),
        JSON.stringify({
            apiKey: "cli-integration-test",
            authResponse: {
                expirationTime: "2999-01-01T00:00:00.000Z",
                spaceId: "00000000000000000000000000",
                botAccount: {
                    id: "00000000000000000000000000",
                    bot: {id: "00000000000000000000000000"},
                },
            },
        }),
    );

    const help = await runCli(["--help"]);
    assert.match(help, /# Alpine CLI/);
    for (const command of ["create", "read", "update", "delete", "search", "scroll", "find"]) {
        assert.match(help, new RegExp(`alpine ${command}`));
    }

    const skillIndex = await runCli(["read", "/skill"]);
    assert.match(skillIndex, /\[Documents\]\(\/skill\/documents\)/);
    assert.match(skillIndex, /\[Tasks\]\(\/skill\/tasks\)/);

    const createSkill = await runCli(["read", "/skill/create"]);
    assert.match(createSkill, /What can you create in Alpine/);

    // The CLI requires an auth file even when the API key is supplied through the environment.
    // It refreshes the authenticated account using the real API before the first command.
    await writeFile(join(apiDataDirectoryPath, "auth.json"), "{}");

    const testTitle = `${githubRunId}-${githubRunAttempt}`;
    const testContent = `${githubRepository} #${testTitle}`;
    const updatedTestContent = `Updated ${testContent}`;

    await testApiEntityLifecycle({
        type: "document",
        pathPrefix: "/document/",
        content: `# ${testTitle}\n\n${testContent}`,
        old: testContent,
        new: updatedTestContent,
    });

    await testApiEntityLifecycle({
        type: "task",
        pathPrefix: "/task/",
        content: `# ${testTitle}\n\n## Notes\n\n${testContent}`,
        old: testContent,
        new: updatedTestContent,
    });

    await testApiEntityLifecycle({
        type: "task-collection",
        pathPrefix: "/task-collection/",
        content: `# ${testTitle}`,
        old: testTitle,
        new: `Updated ${testTitle}`,
    });
} finally {
    await closeTracerServer(tracerServer.server);
    await rm(dataDirectoryPath, {force: true, recursive: true});
    await rm(apiDataDirectoryPath, {force: true, recursive: true});
    await rm(cliArchiveDirectoryPath, {force: true, recursive: true});
    await rm(cliInstallationDirectoryPath, {force: true, recursive: true});
}

/**
 * Packs and installs the exact npm artifact that consumers receive. The install runs the CLI's
 * postinstall hook, so this catches missing patch files and patches that fail outside a workspace.
 */
async function installCli() {
    const [cliArchive] = JSON.parse(
        await runNpm(
            [
                "pack",
                "--json",
                "--pack-destination",
                cliArchiveDirectoryPath,
                "--workspace",
                "@alpine/cli",
            ],
            repositoryPath,
        ),
    );
    const cliArchivePath = join(cliArchiveDirectoryPath, cliArchive.filename);

    await writeFile(
        join(cliInstallationDirectoryPath, "package.json"),
        JSON.stringify({name: "alpine-cli-integration-test", private: true}),
    );
    await runNpm(["install", "--no-audit", "--no-fund", cliArchivePath], cliInstallationDirectoryPath);

    return join(cliInstallationDirectoryPath, "node_modules/.bin/alpine");
}

/** Runs npm and includes all command output if a package lifecycle script fails. */
async function runNpm(args, cwd) {
    const subprocess = spawn(process.execPath, [process.env.npm_execpath, ...args], {cwd});
    let stdout = "";
    let stderr = "";
    subprocess.stdout.setEncoding("utf8");
    subprocess.stderr.setEncoding("utf8");
    subprocess.stdout.on("data", data => {
        stdout += data;
    });
    subprocess.stderr.on("data", data => {
        stderr += data;
    });

    const exitCode = await new Promise((resolveExitCode, rejectExitCode) => {
        subprocess.once("error", rejectExitCode);
        subprocess.once("close", resolveExitCode);
    });
    assert.equal(exitCode, 0, `npm ${args[0]} failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`);

    return stdout;
}

/** Runs the packed-and-installed executable with the integration check's isolated data directory. */
async function runCli(args, {apiKey, apiUrl, baseUrl, dataDirectory} = {}) {
    const subprocess = spawn(process.execPath, [cliPath, ...args], {
        cwd: repositoryPath,
        env: {
            ...process.env,
            ALPINE_DATA_PATH: dataDirectory ?? dataDirectoryPath,
            ALPINE_API_URL: apiUrl ?? tracerServer.baseUrl,
            ALPINE_URL: baseUrl ?? tracerServer.baseUrl,
            ...(apiKey === undefined ? {} : {ALPINE_API_KEY: apiKey}),
        },
    });

    let stdout = "";
    let stderr = "";
    subprocess.stdout.setEncoding("utf8");
    subprocess.stderr.setEncoding("utf8");
    subprocess.stdout.on("data", data => {
        stdout += data;
    });
    subprocess.stderr.on("data", data => {
        stderr += data;
    });

    const exitCode = await new Promise((resolveExitCode, rejectExitCode) => {
        subprocess.once("error", rejectExitCode);
        subprocess.once("close", resolveExitCode);
    });

    assert.equal(
        exitCode,
        0,
        `CLI exited unsuccessfully:\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );

    return stdout;
}

/** Runs the built CLI against the real API with the secret supplied by CI. */
async function runApiCli(args) {
    return await runCli(args, {
        apiKey: cliTestAlpineApiKey,
        apiUrl: "https://api.alpine.inc",
        baseUrl: "https://alpine.inc",
        dataDirectory: apiDataDirectoryPath,
    });
}

/** Creates, reads, updates, and re-reads one real Alpine API resource. */
async function testApiEntityLifecycle({type, pathPrefix, content, old, new: replacement}) {
    const createResponse = await runApiCli(["create", type, content]);
    const path = getCreatedPath(createResponse, pathPrefix);

    const readResponse = await runApiCli(["read", path]);
    assert.equal(readResponse.includes(old), true, `Expected initial ${type} content to be returned.`);

    const updateResponse = await runApiCli([
        "update",
        path,
        `--old=${old}`,
        `--new=${replacement}`,
    ]);
    assert.match(updateResponse, /Update was successful\./);

    const updatedReadResponse = await runApiCli(["read", path]);
    assert.equal(
        updatedReadResponse.includes(replacement),
        true,
        `Expected updated ${type} content to be returned.`,
    );
}

/** Extracts the stable CLI path from a successful create response. */
function getCreatedPath(response, pathPrefix) {
    const escapedPathPrefix = pathPrefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = response.match(new RegExp(`\\]\\((${escapedPathPrefix}[^)]+)\\)`));

    assert.notEqual(match, null, `Expected create response to link to ${pathPrefix}: ${response}`);

    return match[1];
}

/** Starts the local endpoints that the detached CLI tracer uses while commands finish. */
async function createTracerServer() {
    const server = createServer((request, response) => {
        switch (new URL(request.url ?? "/", "http://localhost").pathname) {
            case "/api/time": {
                const time = Date.now();
                response.setHeader("content-type", "application/json");
                response.end(JSON.stringify({endTime: time, startTime: time}));
                return;
            }
            case "/api/tracer":
                response.statusCode = 204;
                response.end();
                return;
            default:
                response.statusCode = 404;
                response.end();
        }
    });

    await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen({host: "127.0.0.1", port: 0}, resolveListen);
    });

    const address = server.address();
    assert(address !== null && typeof address !== "string");

    return {baseUrl: `http://127.0.0.1:${address.port}`, server};
}

/** Stops the local tracer endpoint after every CLI subprocess has finished. */
async function closeTracerServer(server) {
    await new Promise((resolveClose, rejectClose) => {
        server.close(error => {
            if (error) rejectClose(error);
            else resolveClose();
        });
    });
}
