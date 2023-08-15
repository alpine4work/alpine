import cluster from "cluster";
import * as os from "os";
import process from "process";
import {ParseArgsConfig, ParsedResults, parseArgs} from "util";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {InternalError} from "~/shared/error/error.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
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
    run: (
        options: ParsedResults<{options: Options}>["values"],
        tracer: TracerRoot,
    ) => Promise<void>;
}) {
    // In production, run our service across all available CPUs so we get full
    // CPU utilization.
    if (cluster.isPrimary) {
        const workerCount = process.env.NODE_ENV !== "production" ? 1 : os.cpus().length;

        for (let i = 0; i < workerCount; i++) {
            cluster.fork();
        }

        // If any worker in the cluster dies, kill all other workers and exit the
        // process with an error.
        cluster.on("exit", worker => {
            // eslint-disable-next-line no-console
            console.error(
                new InternalError(quote`Worker (id: ${worker.id}) exited, killing cluster`),
            );
            process.exit(1);
        });

        return;
    }

    const parsedOptions = parseArgs({
        strict: true,
        allowPositionals: false,
        options: {
            honeycombApiKey: {type: "string"},
            ...options,
        },
    });

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
            // We don't need to extend the lifetime of our Node.js process with a promise.
            // If the tracer throws an error, well, there's nowhere else to send the error.
            promise.catch(scheduleUncaughtError);
        },
    });

    // Now that we've initialized our tracer, don't crash the process on uncaught
    // exceptions and instead log the exception with our tracer.
    process.off("uncaughtException", handleUncaughtExceptionBeforeTracerInitialization);
    process.on("uncaughtException", error => {
        tracer.logUncaughtException("Uncaught exception", error);
    });

    run(parsedOptions.values, tracer).catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    });
}
