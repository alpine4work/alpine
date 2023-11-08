import cluster, {Worker} from "cluster";
import inspector from "inspector";
import * as os from "os";
import process from "process";
import {ParseArgsConfig, ParsedResults, parseArgs} from "util";
import {
    registerShutdownListener,
    registerShutdownListenerForIngressTraffic,
    registerShutdownWaitUntilPromise,
} from "~/server/node/shutdown_manager.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";

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

/**
 * Helper function for running a Node.js service on AWS EC2. Encapsulates best
 * practices around logging and error handling so our services are consistent.
 */
export function runService<Options extends ParseArgsConfig["options"]>({
    serviceName,
    options,
    run,
}: {
    serviceName: TracerServiceName;
    options: Options;
    run: (options: {
        options: ParsedResults<{options: Options}>["values"];
        tracer: TracerRoot;
        workerIndex: number;
    }) => Promise<void>;
}) {
    // Make our service easy to find in process managers. We include
    // "cyberworlds" and "node" so you can grep by those strings.
    process.title = `${serviceName} ${
        cluster.isPrimary ? "primary" : "worker"
    } (cyberworlds, node)`;

    // In production, run our service across all available CPUs so we get full
    // CPU utilization.
    if (cluster.isPrimary) {
        const workerCount = process.env.NODE_ENV !== "production" ? 1 : os.cpus().length;

        for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
            cluster.fork({
                SERVICE_WORKER_INDEX: workerIndex,
            });
        }

        let isShuttingDown = false;

        // If any worker in the cluster dies, kill all other workers and exit the
        // process with an error.
        cluster.on("exit", worker => {
            // If we are shutting down the cluster then exits are expected.
            if (isShuttingDown) return;

            // eslint-disable-next-line no-console
            console.error(
                new InternalError(quote`Worker (id: ${worker.id}) exited, killing cluster`),
            );
            process.exit(1);
        });

        // If we are the primary node of a cluster then on shutdown, kill all cluster
        // nodes and wait for them to exit before letting shutdown finish.
        registerShutdownListener(async signal => {
            isShuttingDown = true;

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
                worker.kill(signal);
            }

            await exitPromise;
        });
        return;
    }

    const workerIndex = parseInt(assertExists(process.env.SERVICE_WORKER_INDEX), 10);

    const parsedOptions = parseArgs({
        strict: true,
        allowPositionals: false,
        options: {
            honeycombApiKey: {type: "string"},
            inspectorPort: {type: "string"},
            ...options,
        },
    });

    // Start the Node.js inspector if an `--inspectorPort` argument was provided.
    const inspectorPortString: string | undefined = (parsedOptions.values as any).inspectorPort;
    if (inspectorPortString) {
        assert(process.env.NODE_ENV === "development", "Can't inspect process in production");

        inspector.open(parseInt(inspectorPortString, 10));

        registerShutdownListenerForIngressTraffic(async () => {
            inspector.close();
        });
    }

    // If a Honeycomb API key is not provided in production then we get no logging
    // from our service.
    const honeycombApiKey: string | undefined = (parsedOptions.values as any).honeycombApiKey;
    if (!honeycombApiKey && process.env.NODE_ENV === "production")
        throw new InternalError("Must provide `honeycombApiKey` arg in production");

    const tracer = createServerTracer({
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

    // Now that we've initialized our tracer, don't crash the process on uncaught
    // exceptions and instead log the exception with our tracer.
    process.off("uncaughtException", handleUncaughtExceptionBeforeTracerInitialization);
    process.on("uncaughtException", error => {
        tracer.logUncaughtException("Uncaught exception", error);
    });

    run({options: parsedOptions.values, tracer, workerIndex}).catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    });
}
