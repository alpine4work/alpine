import cluster, {Worker} from "cluster";
import inspector from "inspector";
import * as os from "os";
import process from "process";
import {ParseArgsConfig, ParsedResults, parseArgs} from "util";
import {ShutdownManager, registerShutdownWaitUntilPromise} from "~/server/node/shutdown_manager.js";
import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {createServerTracerAndHoneycombClient} from "~/server/tracer/server_tracer.js";
import {ErrorBase, InternalError, UnknownError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.js";

// This file is for running a Node.js service. It shouldn't be used in
// Cloudflare Workers.
assert(process.versions.node);

// Kill the process if we get an uncaught exception before the
// tracer initializes.
function handleUncaughtExceptionBeforeTracerInitialization(error: unknown) {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
}

process.on("uncaughtException", handleUncaughtExceptionBeforeTracerInitialization);

type ServiceClusterMessage = {
    readonly type: "ShutdownTracerPropagationContext";
    readonly propagationContext: TracerSpanPropagationContext;
};

export type ServiceOptions<Options extends ParseArgsConfig["options"]> = ParsedResults<{
    options: Options;
}>["values"];

/**
 * Helper function for running a Node.js service on AWS EC2. Encapsulates best
 * practices around logging and error handling so our services are consistent.
 */
export function runService<Options extends ParseArgsConfig["options"]>({
    serviceName,
    import: importService,
    withoutCluster = false,
}: {
    serviceName: TracerServiceName;
    import: () => Promise<{
        options: Options;
        run: (options: {
            options: ServiceOptions<Options>;
            tracer: TracerRoot;
            honeycombClient: HoneycombTracerClient | null;
            shutdownManager: ShutdownManager;
            workerIndex: number;
        }) => Promise<void>;
    }>;
    withoutCluster?: boolean;
}) {
    // Make our service easy to find in process managers. We include
    // "cyberworlds" and "node" so you can grep by those strings.
    process.title = `${serviceName}${
        withoutCluster ? " " : cluster.isPrimary ? " primary " : " worker "
    }(cyberworlds, node)`;

    async function main() {
        const serviceModuleResult =
            withoutCluster || !cluster.isPrimary
                ? await captureResultPromise(() => importService())
                : null;

        const parsedOptions = parseArgs({
            strict: serviceModuleResult?.ok === true,
            allowPositionals: false,
            options: {
                honeycombApiKey: {type: "string"},
                inspectorPort: {type: "string"},
                ...serviceModuleResult?.value?.options,
            },
        });

        // If a Honeycomb API key is not provided in production then we get no logging
        // from our service.
        const honeycombApiKey: string | undefined = (parsedOptions.values as any).honeycombApiKey;
        if (!honeycombApiKey && process.env.NODE_ENV === "production")
            throw new InternalError('Must provide "honeycombApiKey" option in production');

        const [tracer, honeycombClient] = createServerTracerAndHoneycombClient({
            serviceName,
            jsHost: "Node",
            honeycombApiKey,
            waitUntil: promise => {
                registerShutdownWaitUntilPromise(
                    promise.catch(error => {
                        // eslint-disable-next-line no-console
                        console.error("Exception from server tracer:");
                        // eslint-disable-next-line no-console
                        console.error(error);
                    }),
                );
            },
        });

        const {shutdownManager, shutdown} = ShutdownManager.new({
            tracer,
            isClusterPrimary: cluster.isPrimary,
        });

        // Perform a graceful shutdown when requested. Any code in our system can
        // schedule a callback for graceful shutdown with
        // `shutdownManager.registerListener()`.
        let shutdownTracerPropagationContext: TracerSpanPropagationContext | null = null;
        process.on("SIGINT", () => shutdown("SIGINT", shutdownTracerPropagationContext));
        process.on("SIGTERM", () => shutdown("SIGTERM", shutdownTracerPropagationContext));

        // In production, run our service across all available CPUs so we get full
        // CPU utilization.
        if (!withoutCluster && cluster.isPrimary) {
            const workerCount = process.env.NODE_ENV !== "production" ? 1 : os.cpus().length;

            // If any worker in the cluster dies, shutdown the process with an error.
            // Workers are not expected to exit while the service is running!
            cluster.on("exit", (worker, exitCode, signal) => {
                // If we are currently shutting down the cluster then worker exits are
                // expected.
                if (shutdownManager.isShuttingDown()) return;

                const error = new InternalError(
                    quote`Worker exited with code ${exitCode} by signal ${signal}, killing cluster`,
                );

                shutdown(error, null);
            });

            for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
                cluster.fork({
                    SERVICE_WORKER_INDEX: workerIndex,
                });
            }

            // If we are the primary node of a cluster then on shutdown, kill all cluster
            // nodes and wait for them to exit before letting shutdown finish.
            shutdownManager.registerListener("Killing cluster workers", async (signal, span) => {
                const workers = Object.values(cluster.workers!) as Array<Worker>;

                if (workers.every(worker => worker.isDead())) {
                    return;
                }

                const exitPromise = new Promise<void>(resolve => {
                    cluster.on("exit", () => {
                        if (workers.every(worker => worker.isDead())) {
                            resolve();
                        }
                    });
                });

                for (const worker of workers) {
                    if (worker.isDead()) continue;

                    worker.send(
                        cast<ServiceClusterMessage>({
                            type: "ShutdownTracerPropagationContext",
                            propagationContext: span.getPropagationContext(),
                        }),
                    );

                    worker.kill(typeof signal !== "string" ? "SIGINT" : signal);
                }

                await exitPromise;
            });
            return;
        }

        assert(serviceModuleResult);

        process.on("message", untypedMessage => {
            const message = untypedMessage as ServiceClusterMessage;

            // If in the future we add more message types, TypeScript will error here and
            // we should change this to an exhaustive switch.
            cast<"ShutdownTracerPropagationContext">(message.type);

            shutdownTracerPropagationContext = message.propagationContext;
        });

        const workerIndex = !withoutCluster
            ? parseInt(assertExists(process.env.SERVICE_WORKER_INDEX), 10)
            : 0;

        // Start the Node.js inspector if an `--inspectorPort` argument was provided.
        const inspectorPortString: string | undefined = (parsedOptions.values as any).inspectorPort;
        if (inspectorPortString) {
            assert(process.env.NODE_ENV === "development", "Can't inspect process in production");

            inspector.open(parseInt(inspectorPortString, 10));

            shutdownManager.registerListenerForIngressTraffic(
                "Closing inspector port",
                async () => {
                    inspector.close();
                },
            );
        }

        // Now that we've initialized our tracer, don't crash the process on uncaught
        // exceptions and instead log the exception with our tracer.
        process.off("uncaughtException", handleUncaughtExceptionBeforeTracerInitialization);
        process.on("uncaughtException", error => {
            tracer.logUncaughtException("Uncaught exception", error);
        });

        try {
            const serviceModule = unwrapResult(serviceModuleResult);

            await serviceModule.run({
                options: parsedOptions.values as ServiceOptions<Options>,
                tracer,
                honeycombClient,
                shutdownManager,
                workerIndex,
            });
        } catch (error) {
            let actualError: ErrorBase;

            if (error instanceof ErrorBase) {
                actualError = error;
            } else {
                actualError = UnknownError.from(error);
            }

            shutdown(actualError, null);
            throw actualError;
        }
    }

    main().catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    });
}
