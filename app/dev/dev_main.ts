import {createRequestListener, writeResponse} from "@miniflare/http-server";
import {coupleWebSocket} from "@miniflare/web-sockets";
import chalk from "chalk";
import express from "express";
import fs from "fs-extra";
import http from "http";
import {Miniflare} from "miniflare";
import {Socket} from "net";
import {networkInterfaces} from "os";
import path from "path";
import createServeStaticMiddleware from "serve-static";
import {Headers} from "undici";
import WebSocket from "ws";
import {startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths";
import {parseDotenv} from "~/admin/helpers/parse_dotenv";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";

const env = parseDotenv();

const port = parseInt(assertExists(env.APP_PORT), 10);
const devServerPort = parseInt(assertExists(env.DEV_SERVER_PORT), 10);
const dynamoLocalPort = parseInt(assertExists(env.DYNAMO_LOCAL_PORT), 10);

/* ========================================================================== *\
 *                                Miniflare                                   *
\* ========================================================================== */

const miniflare = new Miniflare({
    scriptPath: path.join(runfilesPath, "cyberworlds/app/build/server.js"),
    compatibilityDate: "2022-07-12",
    compatibilityFlags: ["streams_enable_constructors"],
    modules: true,
    modulesRules: [{type: "ESModule", include: ["**/*.js"], fallthrough: true}],
    sourceMap: true,
    bindings: env,
    durableObjects: {
        DocumentCollaborationDurableObjectNamespace: "DocumentCollaborationDurableObject",
    },
});

const miniflareListener = createRequestListener(miniflare);

let miniflareReloadPromiseResolver = createPromiseResolver();
miniflareReloadPromiseResolver.resolve();

function reloadMiniflare() {
    const promiseResolver = createPromiseResolver();
    miniflareReloadPromiseResolver = promiseResolver;

    miniflare.reload().then(
        () => promiseResolver.resolve(),
        error => promiseResolver.reject(error),
    );
}

/* ========================================================================== *\
 *                               serve-static                                 *
\* ========================================================================== */

const serveStaticMiddleware = createServeStaticMiddleware(
    path.join(runfilesPath, "cyberworlds/app/public"),
    {cacheControl: false},
);

/* ========================================================================== *\
 *                                 DynamoDB                                   *
\* ========================================================================== */

const dynamoDataDirectoryPath = path.join(devEnvPaths.data, "dynamo");

const dynamoLocalPromiseResolver = createPromiseResolver();

startDynamoLocal({
    dataPath: dynamoDataDirectoryPath,
    port: dynamoLocalPort,
}).then(
    () => dynamoLocalPromiseResolver.resolve(),
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
    const chunkString = chunk.toString("utf8");

    // When we start building, create a promise that will resolve when the build
    // completes. The promise will block HTTP requests.
    if (chunkString.includes("IBAZEL_BUILD_STARTED")) {
        bazelBuildPromiseResolver = createPromiseResolver();

        broadcastLog("Rebuilding...");
        return;
    }

    // Resolve the build promise when the build completes!
    if (chunkString.includes("IBAZEL_BUILD_COMPLETED")) {
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
        return;
    }
});

/* ========================================================================== *\
 *                               HTTP Server                                  *
\* ========================================================================== */

const server = http.createServer((req, res) => {
    run();

    function run() {
        // If we have some promises, then wait for them to resolve recursively before
        // our request can run.
        if (!bazelBuildPromiseResolver.isSettled()) {
            bazelBuildPromiseResolver.promise.finally(run);
            return;
        }
        if (!miniflareReloadPromiseResolver.isSettled()) {
            miniflareReloadPromiseResolver.promise.finally(run);
            return;
        }

        // Immediately fail the request if the build has a failure.
        if (hasBazelBuildFailed) {
            res.writeHead(500, {"Content-Type": "text/plain"});
            res.end("Build failed, check Bazel output");
            return;
        }

        // Start by trying to serve our assets...
        serveStaticMiddleware(req, res, () => {
            // If we could not serve an asset then run our Cloudflare worker...
            runPromiseWithoutAwaiting(async () => {
                await miniflareListener(req, res);
            });
        });
    }
});

server.listen(port, () => {
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
 *                             WebSocket Server                               *
\* ========================================================================== */

// This code is almost entirely copied from Miniflare. Ideally Miniflare would
// provide a `createWebSocketServer()` function or similar.
// https://github.com/cloudflare/miniflare/blob/2e49dab9f6b0049323eae180cce1c7fcc2ffbfb0/packages/http-server/src/index.ts#L384-L467

const webSocketServer = new WebSocket.Server({
    noServer: true,
    // Disable automatic handling of `Sec-WebSocket-Protocol` header, Cloudflare
    // Workers require users to include this header themselves in `Response`s:
    // https://github.com/cloudflare/miniflare/issues/179
    handleProtocols: () => false,
});

const restrictedWebSocketUpgradeHeaders = ["upgrade", "connection", "sec-websocket-accept"];

// Add custom headers included in response to WebSocket upgrade requests
const extraHeaders = new WeakMap<http.IncomingMessage, Headers>();
webSocketServer.on("headers", (headers, req) => {
    const extra = extraHeaders.get(req);
    extraHeaders.delete(req);
    if (extra) {
        for (const [key, value] of extra) {
            if (!restrictedWebSocketUpgradeHeaders.includes(key.toLowerCase())) {
                headers.push(`${key}: ${value}`);
            }
        }
    }
});

server.on("upgrade", (req, socket, head) => {
    run();

    function run() {
        // If we have some promises, then wait for them to resolve recursively before
        // our request can run.
        if (!devServerPromiseResolver.isSettled()) {
            devServerPromiseResolver.promise.finally(run);
            return;
        }
        if (!dynamoLocalPromiseResolver.isSettled()) {
            dynamoLocalPromiseResolver.promise.finally(run);
            return;
        }
        if (!bazelBuildPromiseResolver.isSettled()) {
            bazelBuildPromiseResolver.promise.finally(run);
            return;
        }
        if (!miniflareReloadPromiseResolver.isSettled()) {
            miniflareReloadPromiseResolver.promise.finally(run);
            return;
        }

        // `socket` is guaranteed to be an instance of `net.Socket`:
        // https://nodejs.org/api/http.html#event-upgrade_1
        assert(socket instanceof Socket);

        // Immediately fail the request if the build has a failure.
        if (hasBazelBuildFailed) {
            const res = new http.ServerResponse(req);
            res.assignSocket(socket);
            res.writeHead(500, {"Content-Type": "text/plain"});
            res.end("Build failed, check Bazel output");
            return;
        }

        runPromiseWithoutAwaiting(async () => {
            const response = await miniflareListener(req);

            // Check web socket response was returned
            const webSocket = response?.webSocket;
            if (response?.status === 101 && webSocket) {
                // Accept and couple the Web Socket
                extraHeaders.set(req, response.headers);
                webSocketServer.handleUpgrade(req, socket, head, otherWebSocket => {
                    void coupleWebSocket(otherWebSocket, webSocket);
                    webSocketServer.emit("connection", otherWebSocket, req);
                });
                return;
            }

            // Otherwise, we'll be returning a regular HTTP response
            const res = new http.ServerResponse(req);
            res.assignSocket(socket);

            // If no response was provided, or it was an "ok" response, log an error
            if (!response || (200 <= response.status && response.status < 300)) {
                res.writeHead(500);
                res.end();

                // eslint-disable-next-line no-console
                console.error(
                    new TypeError(
                        "Web Socket request did not return status 101 Switching Protocols response with Web Socket",
                    ),
                );
                return;
            }

            await writeResponse(response, res);
        });
    }
});

/* ========================================================================== *\
 *                                Dev Server                                  *
\* ========================================================================== */

const tracerLogDirectoryPath = path.join(devEnvPaths.log, "tracer");
fs.ensureDirSync(tracerLogDirectoryPath);

const devServer = express();

devServer.use(express.json());

devServer.post("/tracer", (req, res, next) => {
    const promise = (async () => {
        const event = req.body;

        const date = new Date();
        const dateString =
            date.getUTCFullYear().toString().padStart(4, "0") +
            "-" +
            (date.getUTCMonth() + 1).toString().padStart(2, "0") +
            "-" +
            date.getUTCDate().toString().padStart(2, "0");

        const tracerLogFilePath = path.join(tracerLogDirectoryPath, `tracer-${dateString}.log`);

        await fs.appendFile(tracerLogFilePath, JSON.stringify(event) + "\n");
    })();

    promise.then(
        () => res.status(200).end(),
        error => next(error),
    );
});

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
