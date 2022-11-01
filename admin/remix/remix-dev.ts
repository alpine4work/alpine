import chalk from "chalk";
import {spawn} from "child_process";
import http from "http";
import path from "path";
import stripAnsi from "strip-ansi";
import {repoDirectoryPath} from "~/server/helpers/repo-directory-path";
import {createPromiseResolver} from "~/shared/helpers/async/promise-resolver";
import {assert} from "~/shared/helpers/control/assert";

assert(process.env.NODE_ENV === "development");

const host = "127.0.0.1";
const prettyHost = host === "127.0.0.1" ? "localhost" : host;
const port = 3000;
const wranglerDevPort = 3001;

// When true we log everything printed to Wrangler stdout.
const debugWrangler = false;

const nodeModulesBinDirectoryPath = path.join(repoDirectoryPath, "node_modules/.bin");

const cleanupListeners: Array<() => Promise<void>> = [];

async function cleanup() {
    const results = await Promise.allSettled(
        cleanupListeners.map(cleanupListener => cleanupListener()),
    );

    for (const result of results) {
        if (result.status === "rejected") {
            throw result.reason;
        }
    }

    return results;
}

/**
 * When we run Remix, we will watch the logs for when builds start and finish.
 * If there is an ongoing build we will set this to an unresolved promise. We
 * will resolve the promise once the build finishes.
 */
let remixBuildPromiseResolver = createPromiseResolver();

/**
 * Runs Remix in watch mode. This will compile all assets with esbuild and
 * recompile assets when they change.
 */
async function runRemix() {
    const subprocess = spawn("remix", ["watch"], {
        cwd: repoDirectoryPath,
        env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH
                ? `${nodeModulesBinDirectoryPath}:${process.env.PATH}`
                : nodeModulesBinDirectoryPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    subprocess.stdout.on("data", chunk => {
        const chunkString: string = chunk.toString("utf8");

        if (/Watching Remix app/.test(chunkString)) {
            // On startup, our Remix build promise should be waiting for the initial build.
            assert(!remixBuildPromiseResolver.isSettled());
        } else if (/Built in/.test(chunkString)) {
            // Resolve our Remix build promise after the initial build.
            assert(!remixBuildPromiseResolver.isSettled());
            remixBuildPromiseResolver.resolve();
        } else if (/File changed/.test(chunkString) || /Rebuilding/.test(chunkString)) {
            // If Remix reports that a file changed, start a new build promise.
            if (remixBuildPromiseResolver.isSettled()) {
                remixBuildPromiseResolver = createPromiseResolver();
            }
        } else if (/Rebuilt in/.test(chunkString)) {
            // Once Remix reports it has finished building, resolve our new rebuild
            // promise.
            assert(!remixBuildPromiseResolver.isSettled());
            remixBuildPromiseResolver.resolve();
        }

        // Forward the chunk string to stdout.
        process.stdout.write(chunkString);
    });

    subprocess.stderr.on("data", chunk => {
        // Forward anything on stderr to our process stderr.
        process.stderr.write(chunk);
    });

    await new Promise<void>((resolve, reject) => {
        subprocess.on("spawn", () => resolve());
        subprocess.on("error", error => reject(error));
    });

    return async () => {
        subprocess.kill();
    };
}

/**
 * Runs the Cloudflare Wrangler dev server.
 *
 * Runs a proxy server in front of the Cloudflare Wrangler dev server that will
 * block requests while a compilation is happening. Once the compilation has
 * finished the proxy server will let the request through. This way when we
 * reload the page we're guaranteed to have the most up to date code.
 */
async function runWrangler() {
    // eslint-disable-next-line no-console
    console.log(`Server listening on ${chalk.bold.underline(`http://${prettyHost}:${port}`)}`);

    let wranglerServer = {
        remixBuildPromise: remixBuildPromiseResolver.promise,
        promiseResolver: createPromiseResolver(),
    };

    /**
     * Whenever we see a new Remix build promise, we want to create a new worker
     * build promise that finishes when Wrangler reports the worker was compiled.
     */
    const waitForWorkerBuild = () => {
        if (wranglerServer.remixBuildPromise !== remixBuildPromiseResolver.promise) {
            wranglerServer = {
                remixBuildPromise: remixBuildPromiseResolver.promise,
                promiseResolver: createPromiseResolver(),
            };
        }

        return wranglerServer.promiseResolver.promise;
    };

    // We proxy all requests to `wrangler` so that if we detect that Remix is
    // building, we can delay requests until Remix is done building.
    const proxyServer = http.createServer((request, response) => {
        waitForWorkerBuild().finally(() => {
            const requestChunks: Array<any> = [];

            request.addListener("data", chunk => requestChunks.push(chunk));

            const attempt = (attemptNumber: number) => {
                const proxyRequest = http.request(
                    new URL(request.url!, `http://${host}:${wranglerDevPort}`),
                    {
                        method: request.method,
                        headers: request.headers,
                    },
                );

                // Replay any chunks we've already received from the request. This happens when
                // we retry the request.
                for (const chunk of requestChunks) {
                    proxyRequest.write(chunk);
                }

                // If the request is done then immediately end the request instead of adding a
                // listener for more chunks. This happens when we retry the request.
                if (request.complete) {
                    proxyRequest.end();
                } else {
                    request.addListener("data", chunk => proxyRequest.write(chunk));
                    request.addListener("end", () => proxyRequest.end());
                }

                proxyRequest.addListener("response", proxyResponse => {
                    response.writeHead(proxyResponse.statusCode!, proxyResponse.headers);
                    proxyResponse.addListener("data", chunk => response.write(chunk));
                    proxyResponse.addListener("end", () => response.end());
                });

                proxyRequest.addListener("error", (error: any) => {
                    // Retry connection errors with exponential backoff because the Wrangler dev
                    // server may be restarting.
                    if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") {
                        const delayMs = 10 * 2 ** (attemptNumber - 1);

                        if (delayMs <= 1000 * 10) {
                            setTimeout(() => {
                                attempt(attemptNumber + 1);
                            }, delayMs);
                            return;
                        }
                    }

                    // eslint-disable-next-line no-console
                    console.error(error);
                    if (!response.headersSent)
                        response.writeHead(500, {"Content-Type": "text/plain"});
                    response.end();
                });
            };

            attempt(1);
        });
    });

    proxyServer.listen(port);

    const subprocess = spawn(
        "wrangler",
        [
            "pages",
            "dev",
            "./public",
            "--compatibility-date=2022-11-01",
            `--ip=${host}`,
            `--port=${wranglerDevPort}`,
            "--log-level=debug",
        ],
        {
            cwd: repoDirectoryPath,
            env: {
                NODE_ENV: process.env.NODE_ENV,
                PATH: process.env.PATH
                    ? `${nodeModulesBinDirectoryPath}:${process.env.PATH}`
                    : nodeModulesBinDirectoryPath,
            },
            stdio: ["ignore", "pipe", "pipe"],
        },
    );

    subprocess.stdout.on("data", chunk => {
        const chunkString: string = chunk.toString("utf8");

        // Wrangler logs this message with `--log-level=debug` when a new local server
        // has started.
        if (/Starting a local server/.test(chunkString)) {
            // Resolve the current worker build promise (if it hadn't already resolved).
            wranglerServer.promiseResolver.resolve();
        }

        // Strip ANSI codes when debugging Wrangler since it prints codes that do
        // things like try and clear the previous line of your terminal.
        if (debugWrangler) {
            process.stdout.write(stripAnsi(chunkString));
        }
    });

    subprocess.stderr.on("data", chunk => {
        const chunkString: string = chunk.toString("utf8");

        // Strip ANSI codes when debugging Wrangler since it prints codes that do
        // things like try and clear the previous line of your terminal.
        if (debugWrangler) {
            process.stderr.write(stripAnsi(chunkString));
        }
    });

    await new Promise<void>((resolve, reject) => {
        subprocess.on("spawn", () => resolve());
        subprocess.on("error", error => reject(error));
    });

    return async () => {
        subprocess.kill();
        proxyServer.close();
    };
}

async function run() {
    const results = await Promise.allSettled<Array<Promise<() => Promise<void>>>>([
        runRemix(),
        runWrangler(),
    ]);

    const errors = [];

    for (const result of results) {
        if (result.status === "rejected") {
            errors.push(result.reason);
        } else {
            cleanupListeners.push(result.value);
        }
    }

    if (errors[0]) throw errors[0];
}

run()
    .catch(async error => {
        await cleanup();
        throw error;
    })
    .catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);

        // We gave everyone a chance to cleanup before we
        // hard exit.
        process.exit(1);
    });

// Run our cleanup functions on uncaught exception before exiting.
process.on("uncaughtException", error => {
    cleanup()
        .then(() => {
            throw error;
        })
        .catch(error => {
            // eslint-disable-next-line no-console
            console.error(error);

            // We gave everyone a chance to cleanup before we
            // hard exit.
            process.exit(1);
        });
});
