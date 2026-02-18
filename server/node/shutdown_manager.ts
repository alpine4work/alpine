import {shutdownManagerTimeoutMs} from "~/server/helpers/node/shutdown_timeouts.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {DeadlineExceededError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan, TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.js";

export type ShutdownReason =
    | {
          readonly type: "Signal";
          readonly signal: "SIGINT" | "SIGTERM";
      }
    | {
          readonly type: "Error";
          readonly error: unknown;
      }
    | {
          readonly type: "ProcessEnded";
      };

export interface ShutdownManagerBase {
    registerListenerForIngressTraffic(
        name: string,
        listener: (reason: ShutdownReason, span: TracerSpan) => Promise<void>,
    ): () => void;

    registerListener(
        name: string,
        listener: (reason: ShutdownReason, span: TracerSpan) => Promise<void>,
    ): () => void;

    registerWaitUntilPromise(promise: Promise<unknown>): void;
}

export class ShutdownManager implements ShutdownManagerBase {
    private readonly _tracer: TracerRoot;
    private readonly _isClusterPrimary: boolean;
    private readonly _flushTracer: () => Promise<void>;
    private _shutdownPromise: Promise<void> | null = null;
    private _ingressTrafficListeners = new Set<
        (reason: ShutdownReason, span: TracerSpan) => Promise<void>
    >();
    private _listeners = new Set<(reason: ShutdownReason, span: TracerSpan) => Promise<void>>();
    private readonly _waitUntilPromises = new Set<Promise<unknown>>();

    private constructor({
        tracer,
        isClusterPrimary,
        flushTracer,
    }: {
        tracer: TracerRoot;
        isClusterPrimary: boolean;
        flushTracer: () => Promise<void>;
    }) {
        this._tracer = tracer;
        this._isClusterPrimary = isClusterPrimary;
        this._flushTracer = flushTracer;
    }

    public static new({
        tracer,
        isClusterPrimary,
        flushTracer,
    }: {
        tracer: TracerRoot;
        isClusterPrimary: boolean;
        flushTracer: () => Promise<void>;
    }): {
        shutdownManager: ShutdownManager;
        shutdown: (
            reason: ShutdownReason,
            propagationContext: TracerSpanPropagationContext | null,
        ) => Promise<void>;
    } {
        const shutdownManager = new ShutdownManager({tracer, isClusterPrimary, flushTracer});

        return {
            shutdownManager,
            shutdown: (reason, propagationContext) =>
                shutdownManager._handleShutdown(reason, propagationContext),
        };
    }

    public isShuttingDown() {
        return this._shutdownPromise !== null;
    }

    private _handleShutdown(
        reason: ShutdownReason,
        propagationContext: TracerSpanPropagationContext | null,
    ): Promise<void> {
        if (this._shutdownPromise !== null) return this._shutdownPromise;
        this._shutdownPromise = this._actuallyHandleShutdown(reason, propagationContext);
        return this._shutdownPromise;
    }

    private async _actuallyHandleShutdown(
        reason: ShutdownReason,
        propagationContext: TracerSpanPropagationContext | null,
    ): Promise<void> {
        const handleSpanName = `Shutdown ${this._tracer.serviceName}${
            !this._isClusterPrimary ? " (worker)" : ""
        }`;
        const spanName = `Handle: ${handleSpanName}`;

        const {span, finishSpan} =
            propagationContext !== null
                ? this._tracer.startSpanFromPropagationContext(spanName, propagationContext)
                : this._tracer.startSpan(spanName);

        span.addPropagatedDataForChildrenOnly({
            context: {
                handler: handleSpanName,
            },
        });

        let hasAddedExceptionToSpan = false;

        if (!hasAddedExceptionToSpan && reason.type === "Error") {
            hasAddedExceptionToSpan = true;
            span.logException("Shutting down because of error", reason.error);
        }

        if (reason.type === "Error") {
            // eslint-disable-next-line no-console
            console.error("Shutdown started by exception:");
            // eslint-disable-next-line no-console
            console.error(reason.error);
        }

        // It's helpful to see service lifecycle events in production logs. All logging
        // in response to user actions should go to Honeycomb.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(`Shutdown started (pid: ${process.pid})`);
        }

        const ingressTrafficShutdownPromise = runAllPromises(
            Array.from(this._ingressTrafficListeners, listener => listener(reason, span)),
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
                runAllPromises(Array.from(this._listeners, listener => listener(reason, span))),
            );

        const waitUntilShutdownPromise = shutdownPromise
            // If a shutdown listener failed, we still want to wait for our `waitUntil()`
            // promises.
            .catch(error => {
                if (!hasAddedExceptionToSpan) {
                    hasAddedExceptionToSpan = true;
                    span.addException(error);
                }
            })
            .then(async () => {
                const errors: Array<unknown> = [];

                // Wait for all promises to resolve. If there's an error, don't throw it until
                // all promises have resolved.
                const wait = async () => {
                    while (this._waitUntilPromises.size > 0) {
                        try {
                            await runAllPromises(this._waitUntilPromises);
                        } catch (error) {
                            errors.push(error);
                        }
                    }
                };

                const hasError = errors.length > 0;
                const error = hasError ? createAggregateError(errors) : null;

                await span.withSpan("Waiting for remaining process promises", async childSpan => {
                    await wait();
                    if (hasError) childSpan.addException(error);
                });

                if (!hasAddedExceptionToSpan && hasError) {
                    hasAddedExceptionToSpan = true;
                    span.addException(error);
                }

                finishSpan();

                // Immediately flush any pending tracer events instead of waiting after the
                // `finishSpan()` call.
                await this._flushTracer();

                // After we finish the span, we need to wait for all `waitUntil()` promises
                // AGAIN since we need to send shutdown spans to our telemetry provider
                // (Honeycomb) and our code to do this passes the telemetry request promise
                // to `waitUntil()`.
                await wait();

                if (hasError) throw error;
            });

        // Create a cancellable timeout that rejects after 5 minutes if shutdown
        // hangs. We use `createTimeout` instead of `wait()` because `wait()`
        // creates a timer that cannot be cancelled. If we used `wait()`, the
        // timer would keep running even after shutdown completes, preventing
        // Node.js from exiting.
        const shutdownTimeoutPromise = createPromiseResolver();
        const timeout = createTimeout(() => {
            shutdownTimeoutPromise.reject(
                new DeadlineExceededError("Shutdown timed out after 5 minutes"),
            );
        }, shutdownManagerTimeoutMs);

        const fullShutdownPromise = Promise.race([
            (async () => {
                await runAllPromises([
                    ingressTrafficShutdownPromise,
                    shutdownPromise,
                    waitUntilShutdownPromise,
                ]);
                timeout.clear();
            })(),
            shutdownTimeoutPromise.promise,
        ]);

        await fullShutdownPromise.then(
            () => {
                // It's helpful to see service lifecycle events in production logs. All logging
                // in response to user actions should go to Honeycomb.
                if (process.env.NODE_ENV === "production") {
                    // eslint-disable-next-line no-console
                    console.log(`Shutdown finished (pid: ${process.pid})`);
                }

                // Don't actually exit the process in unit tests.
                if (!import.meta.jest) {
                    process.exit(reason.type === "Error" ? 1 : 0);
                }
            },
            error => {
                // It's helpful to see service lifecycle events in production logs. All logging
                // in response to user actions should go to Honeycomb.
                if (process.env.NODE_ENV === "production") {
                    // eslint-disable-next-line no-console
                    console.log(`Shutdown finished (pid: ${process.pid})`);
                }

                // Don't actually exit the process in unit tests.
                if (import.meta.jest) {
                    throw error;
                } else {
                    // eslint-disable-next-line no-console
                    console.error("Shutdown finished with exception:");
                    // eslint-disable-next-line no-console
                    console.error(error);

                    process.exit(1);
                }
            },
        );
    }

    /**
     * Register a function that will be called when the process is shutting down.
     * These callbacks are for shutting down sources of ingress traffic like HTTP
     * servers. For an HTTP server you want to register a listener that closes the
     * server from accepting new connections, finish processing existing
     * connections, and return when done.
     *
     * Ingress traffic shutdown listeners will run before all our other shutdown
     * listeners. Since resources may still be used until ingress traffic shuts
     * down.
     */
    public registerListenerForIngressTraffic(
        name: string,
        listener: (reason: ShutdownReason, span: TracerSpan) => Promise<void>,
    ): () => void {
        assert(this._shutdownPromise === null);

        const actualListener: typeof listener = (reason, parentSpan) => {
            return parentSpan.withSpan(name, span => listener(reason, span));
        };

        this._ingressTrafficListeners.add(actualListener);
        return () => {
            this._ingressTrafficListeners.delete(actualListener);
        };
    }

    /**
     * Register a function that will be called when the process is shutting down.
     * This lets you keep the process alive while you finish processing requests or
     * perform any other cleanup.
     *
     * These shutdown listeners run after listeners registered with
     * `registerListenerForIngressTraffic()`. That way we don't close
     * resources being actively used by traffic.
     */
    public registerListener(
        name: string,
        listener: (reason: ShutdownReason, span: TracerSpan) => Promise<void>,
    ): () => void {
        assert(this._shutdownPromise === null);

        const actualListener: typeof listener = (reason, parentSpan) => {
            return parentSpan.withSpan(name, span => listener(reason, span));
        };

        this._listeners.add(actualListener);
        return () => {
            this._listeners.delete(actualListener);
        };
    }

    /**
     * Register a promise which our process can't shutdown before it finishes
     * resolving. These promises are the final thing our shutdown manager resolves
     * before completing a shutdown. That way shutdown listeners can register more
     * wait until promises.
     *
     * This API was inspired by Cloudflare Worker's
     * [`executionContext.waitUntil()`][1] method.
     *
     * [1]: https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#waituntil
     */
    public registerWaitUntilPromise(promise: Promise<unknown>) {
        const waitUntilPromise = promise.then(
            () => {
                this._waitUntilPromises.delete(waitUntilPromise);
            },
            () => {
                this._waitUntilPromises.delete(waitUntilPromise);
            },
        );

        this._waitUntilPromises.add(waitUntilPromise);
    }
}
