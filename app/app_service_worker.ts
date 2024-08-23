import {IncomingMessage, ServerResponse, createServer} from "http";
import {join as joinPath, resolve as resolvePath} from "path";
import createServeStaticMiddleware from "serve-static";
import {WebSocket} from "ws";
import {AppServerConstants, AppServerModule} from "~/app/app_server_types.js";
import {appStaticManifestPaths} from "~/app/static/app_static_manifest_paths.js";
import {getBazelOutputPath} from "~/server/helpers/node/bazel_output_path.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {serverProcessContextParseOptions} from "~/server/node/create_server_process_context.js";
import {serviceTokenAgentParseOptions} from "~/server/node/create_service_token_agent.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager, ShutdownManagerBase} from "~/server/node/shutdown_manager.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

const staticPath = joinPath(runfilesPath, "cyberworlds/app/build/client");
const staticAssetsPath = joinPath(staticPath, "assets");
const staticFontsPath = joinPath(staticPath, "fonts");

type Options = ServiceOptions<typeof options>;

export const options = {
    port: {type: "string"},
    viteDev: {type: "boolean"},
    viteCachePath: {type: "string"},
    bazelDevServerPort: {type: "string"},
    shouldSeedDynamo: {type: "boolean"},
    taskRealtimeServiceLocalPort: {type: "string"},
    ecsCluster: {type: "string"},
    taskRealtimeServiceEcsTaskDefinitionFamily: {type: "string"},
    allMiniLmL6V2LanguageModel: {type: "string"},
    cohereApiKey: {type: "string"},
    apnsCertificate: {type: "string"},
    apnsCertificatePrivateKey: {type: "string"},
    ...serviceTokenAgentParseOptions,
    ...serverProcessContextParseOptions,
} as const;

export async function run({
    options,
    tracer,
    shutdownManager,
}: {
    options: Options;
    tracer: TracerRoot;
    shutdownManager: ShutdownManager;
}) {
    const port = parseInt(assertExists(options.port, "`port` option is required"), 10);
    assert(Number.isInteger(port), "`port` option must be an integer");

    if (options.viteDev && process.env.NODE_ENV !== "development") {
        throw new InternalError("Can only use `viteDevServerPort` option in development");
    }

    // Instead of checking `options.viteDev` check `isViteDevEnabled`. Our compiler
    // should run a constant propagation optimization for production code that sets
    // `process.env.NODE_ENV === "development"` to false and eliminates code that
    // depends on this variable.
    const isViteDevEnabled = process.env.NODE_ENV === "development" && options.viteDev;

    // Serve static assets in integration tests.
    //
    // - When running with `dev` static assets are served by Vite
    // - When running in production static assets are served by `EdgeService`
    const serveStaticMiddleware =
        process.env.NODE_ENV !== "production" && !isViteDevEnabled
            ? createServeStaticMiddleware(staticPath, {
                  setHeaders: (res, path) => {
                      // Remix fingerprints its assets so we can cache them forever. Other assets
                      // (like `favicon.ico`) are cached for a day then can be updated.
                      //
                      // We manually version our font assets so fonts can be cached forever too. If
                      // we need to update a font the file name will change.
                      if (path.startsWith(staticAssetsPath) || path.startsWith(staticFontsPath)) {
                          // - `public`: Means we can store the asset in a shared cache since they don't
                          //   depend on authorization.
                          // - `max-age=31536000`: The asset lives for one year.
                          // - `immutable`: Indicates the response will never update.
                          res.setHeader("cache-control", "public, max-age=31536000, immutable");
                      } else {
                          // - `public`: Means we can store the asset in a shared cache since they don't
                          //   depend on authorization.
                          // - `max-age=86400`: The asset lives for one day.
                          // - `stale-while-revalidate=31536000`: When the asset is stale, the cache is
                          //   allowed to continue using it for a year as long as the cache revalidates
                          //   the asset in the background.
                          res.setHeader(
                              "cache-control",
                              "public, max-age=86400, stale-while-revalidate=31536000",
                          );
                      }
                  },
              })
            : null;

    const appServerConstants: AppServerConstants = {
        tracer,
        shutdownManager: isViteDevEnabled
            ? new HotShutdownManager(tracer, shutdownManager)
            : shutdownManager,
        options,
    };

    let appServerModule: AppServerModule | null = !isViteDevEnabled
        ? // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
          // @ts-ignore: When type checking `//app:app_wrapper` the types for
          // `"~/app/app_server.js"` aren't available. The types are available for
          // `//admin/typescript/workspace:workspace_test` however.
          await import("~/app/app_server.js")
        : null;

    let requestListener = (await appServerModule?.getAppServer(appServerConstants)) ?? null;

    // TODO(calebmer): Block requests that don't come from Cloudflare -> AWS Load Balancer -> us
    // in application code in production.
    const actualRequestListener = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
        // In development, static assets are served by `serve-static` middleware in
        // `AppService`. In production we serve static assets from Cloudflare R2.
        if (
            process.env.NODE_ENV !== "production" &&
            (req.url!.startsWith("/assets/") ||
                appStaticManifestPaths.has(req.url!.replace(/\?.*$/, "")))
        ) {
            if (serveStaticMiddleware === null) {
                res.writeHead(404, {"content-type": "text/plain"});
                res.end("404 Not Found");
            } else {
                serveStaticMiddleware(req, res, () => {
                    res.writeHead(404, {"content-type": "text/plain"});
                    res.end("404 Not Found");
                });
            }
        } else {
            if (!isViteDevEnabled) {
                requestListener!(req, res);
            } else {
                void (async () => {
                    try {
                        const oldAppServerModule = appServerModule;

                        appServerModule = (await viteDevServer!.ssrLoadModule(
                            "/app/app_server.js",
                        )) as AppServerModule;

                        // If the `app_server.ts` module changed then run shutdown listeners from the
                        // old app server module.
                        if (oldAppServerModule !== null && oldAppServerModule !== appServerModule) {
                            assert(
                                appServerConstants.shutdownManager instanceof HotShutdownManager,
                            );
                            appServerConstants.shutdownManager.clear();
                        }

                        requestListener = await appServerModule.getAppServer(appServerConstants);
                        requestListener(req, res);
                    } catch (error) {
                        res.writeHead(500, {"content-type": "text/plain"});

                        if (process.env.NODE_ENV === "production" || !(error instanceof Error)) {
                            res.end("500 Internal Server Error");
                        } else {
                            res.end(`500 Internal Server Error\n\n${error.stack ?? error.message}`);
                        }
                    }
                })();
            }
        }
    };

    const server = createServer(
        isViteDevEnabled
            ? (req, res) => {
                  viteDevServer!.middlewares(req, res, () => {
                      actualRequestListener(req, res);
                  });
              }
            : actualRequestListener,
    );

    server.on("error", error => {
        tracer.logUncaughtException("Uncaught exception from HTTP server", error);
    });

    registerGracefulServerShutdown(shutdownManager, server);

    async function createViteDevServer(vite: typeof import("vite")) {
        // Run Vite in Bazel's build directory. Our dev process manager is responsible
        // for keeping the `//app` target up-to-date which will build all app files
        // necessary here.
        const rootPath = resolvePath(
            getBazelOutputPath(),
            "..",
            assertExists(process.env.JS_BINARY__BINDIR),
        );

        const viteDevServer = await vite.createServer({
            root: rootPath,
            cacheDir: assertExists(
                options.viteCachePath,
                "`viteCachePath` option is required when `viteDev` option is provided",
            ),
            configFile: joinPath(rootPath, "vite.config.mjs"),
            server: {
                middlewareMode: true,
                // Serve the Vite HMR WebSocket server off the same private port as
                // `AppService`. We need to set `clientPort` so Vite doesn't try to access
                // `EdgeService`'s public port which'll block WebSocket connections.
                //
                // This also gives us nice graceful shutdown behavior. `AppService` shouldn't
                // shutdown until the browser reloads and closes its HMR WebSocket connection.
                hmr: {server, clientPort: port},
                // While building Bazel will frequently remove a file then add it back.
                // `atomic` makes sure `chokidar` treats this as one `change` update instead of
                // an `unlink` update then an `add` update.
                watch: {atomic: 500},
            },
        });

        let isShuttingDown = false;
        let hasSentShutDownFullReload = false;

        shutdownManager.registerListenerForIngressTraffic("Closing Vite dev server", async () => {
            isShuttingDown = true;

            // Make sure we initiate a full reload while shutting down so `AppClient` picks
            // up new code.
            if (!hasSentShutDownFullReload) {
                hasSentShutDownFullReload = true;
                viteDevServer.hot.send({type: "full-reload"});
            }

            // Make sure Vite stops watching files after shutdown initiates.
            await viteDevServer.watcher.close();
        });

        shutdownManager.registerListener("Closing Bazel dev server connection", async () => {
            bazelDevSocket.close();
        });

        const bazelDevServerPort = parseInt(
            assertExists(
                options.bazelDevServerPort,
                "`bazelDevServerPort` option is required when `viteDev` option is provided",
            ),
            10,
        );

        // Connect to our Bazel dev WebSocket server and forward message to our Vite
        // dev server.
        const bazelDevSocket = new WebSocket(`ws://localhost:${bazelDevServerPort}`);

        await new Promise((resolve, reject) => {
            bazelDevSocket.once("error", reject);
            bazelDevSocket.once("open", resolve);
        });

        bazelDevSocket.on("error", error => {
            tracer.logUncaughtException(
                "Uncaught exception from Bazel dev server WebSocket",
                error,
            );
        });

        bazelDevSocket.on("close", (code, reason) => {
            if (isShuttingDown) return;

            tracer.logUncaughtException(
                "Uncaught exception from Bazel dev server WebSocket",
                new InternalError(
                    `WebSocket closed unexpectedly with code ${code}${
                        reason.length > 0 ? quote`and reason ${reason.toString("utf8")}` : ""
                    }`,
                ),
            );
        });

        bazelDevSocket.on("message", rawMessage => {
            if (isShuttingDown) return;

            const message: {type: "Log"; message: string} | {type: "Reload"} = JSON.parse(
                rawMessage.toString("utf8"),
            );

            switch (message.type) {
                case "Log": {
                    viteDevServer.hot.send({
                        type: "custom",
                        event: "cyberworlds:bazel:log",
                        data: {message: message.message},
                    });
                    break;
                }
                case "Reload": {
                    if (!hasSentShutDownFullReload) {
                        hasSentShutDownFullReload = true;
                        viteDevServer.hot.send({type: "full-reload"});
                    }
                    break;
                }
                default:
                    throw exhaustive(message);
            }
        });

        return viteDevServer;
    }

    const viteDevServer = isViteDevEnabled ? await import("vite").then(createViteDevServer) : null;

    // TODO(calebmer): The way the Node.js `cluster` module works is when multiple
    // workers listen to the same `port` it randomly picks the worker to send a
    // request to. However, we've configured [AWS ALB sticky sessions][1] so we can
    // take advantage of in-memory caches. While AWS ALB routes us to the same EC2
    // instance, then Node.js takes over and puts us in a random process! So we
    // can't actually take advantage of in-memory caches without many cache misses.
    //
    // We need to [implement sticky sessions ourselves][2] for a Node.js cluster.
    // There are [modules like `sticky-session`][3] that do this but they route
    // based on IP address. AWS ALB requests probably come from the same IPs and
    // don't reflect the client's IP. That would destroy the benefits of clustering
    // since all AWS ALB requests go to one process instead of distributed across
    // multiple processes.
    //
    // Instead we should piggy-back off of AWS ALB sticky sessions to decide which
    // worker to send a request to. AWS ALB has "application controlled" sticky
    // sessions which is probably the feature we need to leverage to make this
    // work. We can use the `sticky-session` module as inspiration of how to
    // implement this on the Node.js side.
    //
    // [1]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html
    // [2]: https://stackoverflow.com/questions/51301126/nodejs-clustering-with-sticky-session
    // [3]: https://github.com/indutny/sticky-session
    //
    // TODO(calebmer): It would be nice if sticky sessions directed all traffic for
    // a `SpaceId` to one or two `AppService` instances. Probably two `AppService`
    // instances to avoid bugs where we're depending on in-memory state. That way
    // we could really take advantage of space-level in-memory caches.
    server.listen(port, () => {
        // Log when ready in production to help when debugging container startup.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(`Listening on port ${port} (pid ${process.pid})`);
        }
    });
}

class HotShutdownManager implements ShutdownManagerBase {
    private readonly _tracer: TracerRoot;
    private readonly _shutdownManager: ShutdownManager;
    private _ingressTrafficListeners = new Map<
        (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>,
        () => void
    >();
    private _listeners = new Map<
        (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>,
        () => void
    >();

    constructor(tracer: TracerRoot, shutdownManager: ShutdownManager) {
        this._tracer = tracer;
        this._shutdownManager = shutdownManager;
    }

    public clear() {
        const signal = "SIGINT";

        const handleSpanName = `Shutdown ${this._tracer.serviceName} (hot clear)`;
        const spanName = `Handle: ${handleSpanName}`;

        const {span, finishSpan} = this._tracer.startSpan(spanName);

        span.addPropagatedDataForChildrenOnly({
            context: {
                handler: handleSpanName,
            },
        });

        let hasAddedExceptionToSpan = false;

        if (this._ingressTrafficListeners.size === 0 && this._listeners.size === 0) {
            finishSpan();
        } else {
            const ingressTrafficListeners = new Set(this._ingressTrafficListeners.keys());
            const listeners = new Set(this._listeners.keys());

            // Unregister our shutdown listeners from the main shutdown listener now that
            // we're running them here.
            for (const unregister of this._ingressTrafficListeners.values()) {
                unregister();
            }
            for (const unregister of this._listeners.values()) {
                unregister();
            }

            this._ingressTrafficListeners.clear();
            this._listeners.clear();

            const ingressTrafficShutdownPromise = runAllPromises(
                Array.from(ingressTrafficListeners, listener => listener(signal, span)),
            );

            const shutdownPromise = ingressTrafficShutdownPromise
                // If an ingress traffic shutdown listener failed, we still want to run our
                // other shutdown listeners.
                .catch(error => {
                    if (!hasAddedExceptionToSpan) {
                        hasAddedExceptionToSpan = true;
                        span.addException(error);
                    }
                })
                .then(() =>
                    runAllPromises(Array.from(listeners, listener => listener(signal, span))),
                );

            const fullShutdownPromise = runAllPromises([
                ingressTrafficShutdownPromise,
                shutdownPromise
                    // If a shutdown listener failed, we still want to wait for our `waitUntil()`
                    // promises.
                    .catch(error => {
                        if (!hasAddedExceptionToSpan) {
                            hasAddedExceptionToSpan = true;
                            span.addException(error);
                        }
                    }),
            ]);

            fullShutdownPromise.then(
                () => {
                    finishSpan();
                },
                error => {
                    finishSpan();

                    // eslint-disable-next-line no-console
                    console.error("Shutdown finished with exception:");
                    // eslint-disable-next-line no-console
                    console.error(error);
                },
            );
        }
    }

    public registerListenerForIngressTraffic(
        name: string,
        listener: (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>,
    ): () => void {
        const unregister = this._shutdownManager.registerListenerForIngressTraffic(name, listener);
        this._ingressTrafficListeners.set(listener, unregister);
        return () => {
            this._ingressTrafficListeners.delete(listener);
            unregister();
        };
    }

    public registerListener(
        name: string,
        listener: (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>,
    ): () => void {
        const unregister = this._shutdownManager.registerListener(name, listener);
        this._listeners.set(listener, unregister);
        return () => {
            this._listeners.delete(listener);
            unregister();
        };
    }

    public registerWaitUntilPromise(promise: Promise<unknown>) {
        this._shutdownManager.registerWaitUntilPromise(promise);
    }
}
