import {createRequestListener} from "@miniflare/http-server";
import chalk from "chalk";
import http from "http";
import {Miniflare} from "miniflare";
import path from "path";
import createServeStaticMiddleware from "serve-static";
import WebSocket from "ws";
// eslint-disable-next-line import/no-restricted-paths
import {startLocalstack} from "~/admin/aws/localstack/localstack";
// eslint-disable-next-line import/no-restricted-paths
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver";

const host = "127.0.0.1";
const prettyHost = host === "127.0.0.1" ? "localhost" : host;
const port = 3000;
const devServerPort = 3001;

/* ========================================================================== *\
 *                                Miniflare                                   *
\* ========================================================================== */

const miniflare = new Miniflare({
    scriptPath: path.join(runfilesPath, "cyberworlds/app/build/server.js"),
    sourceMap: true,
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
 *                                LocalStack                                  *
\* ========================================================================== */

// If we fail to start LocalStack, crash the process.
startLocalstack().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});

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

function broadcast(event: unknown) {
    webSocketServer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(event));
        }
    });
}

function broadcastLog(message: string) {
    message = `💿 ${message}`;
    broadcast({type: "LOG", message});
}
