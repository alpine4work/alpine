import cluster, {Worker} from "cluster";
import inspector from "inspector";
import * as os from "os";
import process from "process";
import {ParseArgsConfig, ParsedResults, parseArgs} from "util";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {createServerTracerAndHoneycombClient} from "~/server/tracer/server_tracer.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerSpan, TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.js";

// This file is for running a Node.js service. It shouldn't be used in
// Cloudflare Workers.
assert(process.versions.node);

// More error stack frames in development to help debug issues. The defaults is
// 10 which frequently isn't enough for us given our code typically features
// deep call stacks.
if (process.env.NODE_ENV !== "production") {
    assert(typeof Error.stackTraceLimit === "number");
    Error.stackTraceLimit *= 2;
}

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
            startupSpan: TracerSpan;
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

        const deleteEnvKeys = new Set<string>();

        // Perform environment variable substitution for any CLI options. That way:
        //
        // 1. We don't need to run in a shell
        // 2. Long environment variables (e.g. RSA keys) aren't passed into the
        //    program's arguments
        //
        // Prefer accessing environment variables through args! That way you can't
        // access secrets via the `process.env` global from anywhere in the code.
        for (const [key, value] of Object.entries(parsedOptions.values)) {
            if (typeof value !== "string" || !value.startsWith("$")) continue;

            const envKey = value.slice(1);
            const envValue = process.env[envKey];

            deleteEnvKeys.add(envKey);

            if (envValue === undefined)
                throw new InternalError(quote`Env variable ${envKey} does not exist`);

            (parsedOptions.values as any)[key] = envValue;
        }

        // If a Honeycomb API key is not provided in production then we get no logging
        // from our service.
        const honeycombApiKey: string | undefined = (parsedOptions.values as any).honeycombApiKey;
        if (!honeycombApiKey && process.env.NODE_ENV === "production")
            throw new InternalError("Must provide `honeycombApiKey` option in production");

        let awsTracerSharedData: {ec2InstanceId: string; ecsTaskId: string} | undefined;

        if (process.env.NODE_ENV === "production") {
            const [ecsTaskId, ec2InstanceId] = await runAllPromiseThunks(
                async () => {
                    const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
                    assert(metadataUri, "Expected service to be running in ECS");

                    // eslint-disable-next-line no-global-fetch
                    const response = await fetch(`${metadataUri}/task`);
                    const metadata = await response.json();

                    // Task ARN format: arn:aws:ecs:region:account:task/cluster-name/task-id
                    const taskArn = metadata.TaskARN;
                    assert(typeof taskArn === "string", "Expected `TaskARN` string");

                    const taskId = assertExists(taskArn.split("/").pop());
                    return taskId;
                },
                async () => {
                    // IMDSv2 requires a token first
                    // eslint-disable-next-line no-global-fetch
                    const tokenResponse = await fetch("http://169.254.169.254/latest/api/token", {
                        method: "PUT",
                        headers: {"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
                    });
                    const token = await tokenResponse.text();

                    // eslint-disable-next-line no-global-fetch
                    const response = await fetch(
                        "http://169.254.169.254/latest/meta-data/instance-id",
                        {headers: {"X-aws-ec2-metadata-token": token}},
                    );

                    const instanceId = await response.text();
                    return instanceId.trim();
                },
            );

            awsTracerSharedData = {
                ec2InstanceId,
                ecsTaskId,
            };
        }

        const [tracer, honeycombClient] = createServerTracerAndHoneycombClient({
            serviceName,
            jsHost: "Node",
            aws: awsTracerSharedData,
            honeycombApiKey,
            waitUntil: promise => {
                shutdownManager.registerWaitUntilPromise(
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
            flushTracer: async () => {
                await honeycombClient?.flushScheduledEventBatch();
            },
        });

        // Perform a graceful shutdown when requested. Any code in our system can
        // schedule a callback for graceful shutdown with
        // `shutdownManager.registerListener()`.
        let shutdownTracerPropagationContext: TracerSpanPropagationContext | null = null;
        process.on("SIGINT", () => {
            void shutdown({type: "Signal", signal: "SIGINT"}, shutdownTracerPropagationContext);
        });
        process.on("SIGTERM", () => {
            void shutdown({type: "Signal", signal: "SIGTERM"}, shutdownTracerPropagationContext);
        });

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

                void shutdown({type: "Error", error}, null);
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

                    worker.kill(signal.type === "Signal" ? signal.signal : "SIGINT");
                }

                await exitPromise;
            });
            return;
        }

        assert(serviceModuleResult);

        // Don't allow access to the environment variable anywhere else in the program.
        // Force key usage to be controlled here from the top of the program.
        //
        // Also secures against attacks where an attacker finds a way to inspect
        // `process.env`.
        //
        // We only delete environment variables on workers. Don't delete on the cluster
        // primary. Since the cluster primary passes `process.env` to worker children
        // it spawns with `cluster.fork()`.
        for (const envKey of deleteEnvKeys) {
            delete process.env[envKey];
        }

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
            assert(process.env.NODE_ENV === "development", "Can’t inspect process in production");

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
            tracer.logException("Uncaught exception", error);
        });

        const handleSpanName = `Startup ${serviceName} (worker)`;
        const spanName = `Handle: ${handleSpanName}`;

        const {span: startupSpan, finishSpan: finishStartupSpan} = tracer.startSpan(spanName);

        startupSpan.addPropagatedDataForChildrenOnly({
            context: {
                handler: handleSpanName,
            },
        });

        try {
            const serviceModule = unwrapResult(serviceModuleResult);

            await serviceModule.run({
                options: parsedOptions.values as ServiceOptions<Options>,
                tracer,
                startupSpan,
                honeycombClient,
                shutdownManager,
                workerIndex,
            });

            finishStartupSpan();
        } catch (error) {
            startupSpan.addException(error);
            finishStartupSpan();

            void shutdown({type: "Error", error}, null);

            // We don't need to `throw actualError` since calling `shutdown()` will make
            // sure the process exits with exit code 1 once all shutdown listeners have
            // been run.
        }
    }

    const handleBeforeExitDuringMainCall = () => {
        // Node.js does not wait for promises to resolve before exiting. There needs to
        // be some IO to keep the Node.js event loop active. You can think of [promises
        // in Node.js as a timeout you've called `timeout.unref()` on][1]. There's an
        // issue in the Node.js repo "[Nodejs does not wait for promise resolution -
        // exits instead][2]" where the community complains about this behavior.
        //
        // When the Node.js event loop is emptied [`beforeExit` is emitted][3] and
        // Node.js exits with an exit code of 0. This makes accidentally awaiting a
        // promise that never resolves infuriating to debug. It looks likes the program
        // exits normally without throwing an error or running any `finally` cleanups.
        //
        // So if `beforeExit` is emit before `main()` finishes running we assume the
        // service hasn't actually finished the work it wants to do. We set the exit
        // code to 1 to more clearly communicate the process failed and log this
        // message to help the developer debug the issue.
        //
        // We found this Node.js behavior due to a deadlock in our promise-based
        // `Mutex` implementation, reproduction:
        //
        // ```ts
        // const mutex = new Mutex();
        //
        // await mutex.withLock(async () => {
        //     await mutex.withLock(async () => {
        //         console.log("Hello, world!");
        //     });
        // });
        // ```
        //
        // [1]: https://nodejs.org/api/timers.html#timeoutunref
        // [2]: https://github.com/nodejs/node/issues/22088
        // [3]: https://nodejs.org/api/process.html#event-beforeexit
        //
        // eslint-disable-next-line no-console
        console.error(
            "Event loop has emptied before service finished running. This is likely due to awaiting a promise that never resolves. The simplest example of this is: `await new Promise(() => {})`. Another cause we’ve seen is a deadlock in our promise-based mutex implementation (`shared/helpers/async/mutex.ts`).",
        );

        process.exitCode = 1;
    };

    process.on("beforeExit", handleBeforeExitDuringMainCall);

    main().then(
        () => {
            process.off("beforeExit", handleBeforeExitDuringMainCall);
            process.exitCode = 0;

            // Don't actually call `process.exit()` at this point. For services that start
            // HTTP servers the service will need to keep running until a shutdown signal
            // is received (see `shutdownManager`).
        },
        error => {
            process.off("beforeExit", handleBeforeExitDuringMainCall);
            process.exitCode = 1;

            // eslint-disable-next-line no-console
            console.error(error);
        },
    );
}
