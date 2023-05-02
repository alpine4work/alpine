import chalk from "chalk";
import express from "express";
import fs from "fs-extra";
import http from "http";
import {networkInterfaces} from "os";
import path from "path";
import WebSocket from "ws";
import {startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths";
import {parseDotenv} from "~/admin/helpers/parse_dotenv";
import {createLocalServer} from "~/app/local/create_local_server";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {quote} from "~/shared/helpers/string/quote";

const env = parseDotenv();

const port = parseInt(assertExists(env.APP_PORT), 10);
const devServerPort = parseInt(assertExists(env.DEV_SERVER_PORT), 10);
const dynamoLocalPort = parseInt(assertExists(env.DYNAMO_LOCAL_PORT), 10);

/* ========================================================================== *\
 *                                Miniflare                                   *
\* ========================================================================== */

const localAppServer = createLocalServer({
    globals: {
        __shouldSeedDynamo: true,
        __writeDevTracerEvent: writeDevTracerEvent,
        __logOneTimePassword: ({
            emailAddress,
            oneTimePassword,
        }: {
            emailAddress: string;
            oneTimePassword: string;
        }) => {
            // eslint-disable-next-line no-console
            console.log(quote`✉️  The one time password for ${emailAddress} is ${oneTimePassword}`);
        },
    },
    middleware: (req, res, next) => {
        run();

        function run() {
            // If we have some promises, then wait for them to resolve before
            // our request can run.
            if (shouldWait(run)) return;

            // Immediately fail the request if the build has a failure.
            if (hasBazelBuildFailed) {
                res.writeHead(500, {"Content-Type": "text/plain"});
                res.end("Build failed, check Bazel output");
                return;
            }

            next();
        }
    },
    upgradeMiddleware: (req, socket, next) => {
        run();

        function run() {
            // If we have some promises, then wait for them to resolve before
            // our request can run.
            if (shouldWait(run)) return;

            // Immediately fail the request if the build has a failure.
            if (hasBazelBuildFailed) {
                const res = new http.ServerResponse(req);
                res.assignSocket(socket);
                res.writeHead(500, {"Content-Type": "text/plain"});
                res.end("Build failed, check Bazel output");
                return;
            }

            next();
        }
    },
});

let miniflareReloadPromiseResolver = createPromiseResolver();
miniflareReloadPromiseResolver.resolve();

function reloadMiniflare() {
    const promiseResolver = createPromiseResolver();
    miniflareReloadPromiseResolver = promiseResolver;

    localAppServer.miniflare.reload().then(
        () => promiseResolver.resolve(),
        error => promiseResolver.reject(error),
    );
}

/* ========================================================================== *\
 *                                 DynamoDB                                   *
\* ========================================================================== */

const dynamoDataDirectoryPath = path.join(devEnvPaths.data, "dynamo");

const dynamoLocalPromiseResolver = createPromiseResolver();

startDynamoLocal({
    dataPath: dynamoDataDirectoryPath,
    port: dynamoLocalPort,
}).then(
    () => {
        dynamoLocalPromiseResolver.resolve();
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        dynamoLocalPromiseResolver.resolve();
    },
);

/* ========================================================================== *\
 *                                  ibazel                                    *
\* ========================================================================== */

let bazelBuildPromiseResolver = createPromiseResolver();
bazelBuildPromiseResolver.resolve();

let hasBazelBuildFailed = false;

process.stdin.resume();

// Listen for `ibazel` change notifications.
// https://github.com/bazelbuild/bazel-watcher
process.stdin.on("data", chunk => {
    let chunkString = chunk.toString("utf8");

    // When we start building, create a promise that will resolve when the build
    // completes. The promise will block HTTP requests.
    {
        const buildStartString = "IBAZEL_BUILD_STARTED";
        const index = chunkString.indexOf(buildStartString);
        if (index !== -1) {
            bazelBuildPromiseResolver = createPromiseResolver();

            broadcastLog("Rebuilding...");

            // Let the function continue with the rest of the chunk string...
            chunkString = chunkString.slice(index + buildStartString.length);
        }
    }

    // Resolve the build promise when the build completes!
    {
        const buildCompleteString = "IBAZEL_BUILD_COMPLETED";
        const index = chunkString.indexOf(buildCompleteString);
        if (index !== -1) {
            // If the build failed, set a flag. We will return a 500 for all server
            // messages until the next successful build.
            if (chunkString.includes("IBAZEL_BUILD_COMPLETED FAILURE")) {
                hasBazelBuildFailed = true;
                broadcastLog("Build failed, check Bazel output");
            } else {
                hasBazelBuildFailed = false;
                reloadMiniflare();
                broadcast({type: "RELOAD"});
            }

            bazelBuildPromiseResolver.resolve();

            // Let the function continue with the rest of the chunk string...
            chunkString = chunkString.slice(index + buildCompleteString.length);
        }
    }
});

/* ========================================================================== *\
 *                               HTTP Server                                  *
\* ========================================================================== */

function shouldWait(tryAgain: () => void) {
    if (!devServerPromiseResolver.isSettled()) {
        const timeout = createTimeout(() => {
            // eslint-disable-next-line no-console
            console.log("`devServerPromiseResolver` took more than 5s to resolve");
        }, 5000);

        devServerPromiseResolver.promise.finally(() => {
            timeout.clear();
            tryAgain();
        });
        return true;
    }

    if (!dynamoLocalPromiseResolver.isSettled()) {
        const timeout = createTimeout(() => {
            // eslint-disable-next-line no-console
            console.log("`dynamoLocalPromiseResolver` took more than 5s to resolve");
        }, 5000);

        dynamoLocalPromiseResolver.promise.finally(() => {
            timeout.clear();
            tryAgain();
        });
        return true;
    }

    if (!bazelBuildPromiseResolver.isSettled()) {
        const timeout = createTimeout(() => {
            // eslint-disable-next-line no-console
            console.log("`bazelBuildPromiseResolver` took more than 5s to resolve");
        }, 5000);

        bazelBuildPromiseResolver.promise.finally(() => {
            timeout.clear();
            tryAgain();
        });
        return true;
    }

    if (!miniflareReloadPromiseResolver.isSettled()) {
        const timeout = createTimeout(() => {
            // eslint-disable-next-line no-console
            console.log("`miniflareReloadPromiseResolver` took more than 5s to resolve");
        }, 5000);

        miniflareReloadPromiseResolver.promise.finally(() => {
            timeout.clear();
            tryAgain();
        });
        return true;
    }

    return false;
}

localAppServer.server.listen(port, () => {
    const externalHost = (() => {
        for (const [name, nets] of Object.entries(networkInterfaces())) {
            if (!nets) continue;
            for (const networkInterface of nets) {
                // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
                // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
                const familyV4Value = typeof networkInterface.family === "string" ? "IPv4" : 4;
                if (networkInterface.family === familyV4Value && !networkInterface.internal) {
                    if (name === "en0") {
                        return networkInterface.address;
                    }
                }
            }
        }
        return null;
    })();

    process.stdout.write(`\


Development environment running on ${chalk.underline.bold(`http://localhost:${port}`)}

- Start the Chrome debugger at: ${chalk.underline("chrome://inspect")}
${
    externalHost
        ? `- Other devices on your network can access: ${chalk.underline(
              `http://${externalHost}:${port}`,
          )}\n`
        : ""
}\
- Tracer logs are available at: ${chalk.underline(tracerLogDirectoryPath)}


`);
});

/* ========================================================================== *\
 *                                Dev Server                                  *
\* ========================================================================== */

const tracerLogDirectoryPath = path.join(devEnvPaths.log, "tracer");
fs.ensureDirSync(tracerLogDirectoryPath);

const devServer = express();

const devServerPromiseResolver = createPromiseResolver();

const actualDevServer = http.createServer();
actualDevServer.on("request", devServer);
actualDevServer.listen(devServerPort, () => devServerPromiseResolver.resolve());

const devWebSocketServer = new WebSocket.Server({
    server: actualDevServer,
});

function broadcast(event: unknown) {
    devWebSocketServer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(event));
        }
    });
}

function broadcastLog(message: string) {
    message = `💿 ${message}`;
    broadcast({type: "LOG", message});
}

/* ========================================================================== *\
 *                                  Tracer                                    *
\* ========================================================================== */

function writeDevTracerEvent(event: unknown) {
    runPromiseWithoutAwaiting(async () => {
        const date = new Date();
        const dateString =
            date.getUTCFullYear().toString().padStart(4, "0") +
            "-" +
            (date.getUTCMonth() + 1).toString().padStart(2, "0") +
            "-" +
            date.getUTCDate().toString().padStart(2, "0");

        const tracerLogFilePath = path.join(tracerLogDirectoryPath, `tracer-${dateString}.log`);

        await fs.appendFile(tracerLogFilePath, JSON.stringify(event) + "\n");
    });
}
