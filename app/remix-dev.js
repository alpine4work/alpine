"use strict";

const path = require("path");
const http = require("http");
const chalk = require("chalk");
const {Miniflare} = require("miniflare");
const {createRequestListener} = require("@miniflare/http-server");
const createServeStaticMiddleware = require("serve-static");
const WebSocket = require("ws");

const runfilesPath = process.env.RUNFILES;

const host = "127.0.0.1";
const prettyHost = host === "127.0.0.1" ? "localhost" : host;
const port = 3000;
const devServerPort = 3001;

/* ========================================================================== *\
 *                                Miniflare                                   *
\* ========================================================================== */

const miniflare = new Miniflare({
    scriptPath: path.join(runfilesPath, "cyberworlds/app/build/server.js"),
});

const miniflareListener = createRequestListener(miniflare);

let miniflareReloadPromise = null;

function reloadMiniflare() {
    miniflareReloadPromise = miniflare.reload();
    miniflareReloadPromise.finally(() => {
        miniflareReloadPromise = null;
    });
}

/* ========================================================================== *\
 *                               serve-static                                 *
\* ========================================================================== */

const serveStaticMiddleware = createServeStaticMiddleware(
    path.join(runfilesPath, "cyberworlds/app/public"),
    {cacheControl: false},
);

/* ========================================================================== *\
 *                                  ibazel                                    *
\* ========================================================================== */

let buildPromise = null;
let buildPromiseResolve = null;
let hasBuildFailed = false;

process.stdin.resume();

// Listen for `ibazel` change notifications.
// https://github.com/bazelbuild/bazel-watcher
process.stdin.on("data", chunk => {
    const chunkString = chunk.toString("utf8");

    // When we start building, create a promise that will resolve when the build
    // completes. The promise will block HTTP requests.
    if (chunkString.includes("IBAZEL_BUILD_STARTED")) {
        buildPromise = new Promise(resolve => {
            buildPromiseResolve = resolve;
        });

        broadcastLog("Rebuilding...");
        return;
    }

    // Resolve the build promise when the build completes!
    if (chunkString.includes("IBAZEL_BUILD_COMPLETED")) {
        // If the build failed, set a flag. We will return a 500 for all server
        // messages until the next successful build.
        if (chunkString.includes("IBAZEL_BUILD_COMPLETED FAILURE")) {
            hasBuildFailed = true;
            broadcastLog("Build failed, check Bazel output");
        } else {
            hasBuildFailed = false;
            reloadMiniflare();
            broadcast({type: "RELOAD"});
        }

        if (buildPromiseResolve) {
            buildPromiseResolve();
            buildPromise = null;
            buildPromiseResolve = null;
        }
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
        if (buildPromise) {
            buildPromise.finally(run);
            return;
        }
        if (miniflareReloadPromise) {
            miniflareReloadPromise.finally(run);
            return;
        }

        // Immediately fail the request if the build has a failure.
        if (hasBuildFailed) {
            res.writeHead(500, {"Content-Type": "text/plain"});
            res.end("Build failed, check Bazel output");
            return;
        }

        // Start by trying to serve our assets...
        serveStaticMiddleware(req, res, error => {
            if (error) {
                // eslint-disable-next-line no-console
                console.error(error);
                return;
            }

            // If we could not serve an asset then run our Cloudflare worker...
            miniflareListener(req, res).catch(error => {
                // eslint-disable-next-line no-console
                console.error(error);
            });
        });
    }
});

server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`App listening on ${chalk.underline.bold(`http://${prettyHost}:${port}`)}`);
});

/* ========================================================================== *\
 *                             WebSocket Server                               *
\* ========================================================================== */

const webSocketServer = new WebSocket.Server({
    host,
    port: devServerPort,
});

function broadcast(event) {
    webSocketServer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(event));
        }
    });
}

function broadcastLog(message) {
    message = `💿 ${message}`;
    broadcast({type: "LOG", message});
}
