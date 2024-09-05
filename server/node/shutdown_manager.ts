import {ErrorBase} from "~/shared/error/error.js";
import {
    getAggregateErrorPriority,
    runAllPromises,
} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan, TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.js";

export interface ShutdownManagerBase {
    registerListenerForIngressTraffic(
        name: string,
        listener: (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>,
    ): () => void;

    registerListener(
        name: string,
        listener: (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>,
    ): () => void;

    registerWaitUntilPromise(promise: Promise<unknown>): void;
}

export class ShutdownManager implements ShutdownManagerBase {
    private readonly _tracer: TracerRoot;
    private readonly _isClusterPrimary: boolean;
    private _isShuttingDown = false;
    private _ingressTrafficListeners = new Set<
        (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>
    >();
    private _listeners = new Set<
        (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>
    >();
    private readonly _waitUntilPromises = new Set<Promise<unknown>>();

    private constructor({
        tracer,
        isClusterPrimary,
    }: {
        tracer: TracerRoot;
        isClusterPrimary: boolean;
    }) {
        this._tracer = tracer;
        this._isClusterPrimary = isClusterPrimary;
    }

    public static new({
        tracer,
        isClusterPrimary,
    }: {
        tracer: TracerRoot;
        isClusterPrimary: boolean;
    }): {
        shutdownManager: ShutdownManager;
        shutdown: (
            signal: "SIGINT" | "SIGTERM" | ErrorBase,
            propagationContext: TracerSpanPropagationContext | null,
        ) => void;
    } {
        const shutdownManager = new ShutdownManager({tracer, isClusterPrimary});

        return {
            shutdownManager,
            shutdown: (signal, propagationContext) =>
                shutdownManager._handleShutdown(signal, propagationContext),
        };
    }

    public isShuttingDown() {
        return this._isShuttingDown;
    }

    private _handleShutdown(
        signal: "SIGINT" | "SIGTERM" | ErrorBase,
        propagationContext: TracerSpanPropagationContext | null,
    ) {
        if (this._isShuttingDown) return;
        this._isShuttingDown = true;

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

        if (!hasAddedExceptionToSpan && signal instanceof ErrorBase) {
            hasAddedExceptionToSpan = true;
            span.addException(signal);
        }

        if (signal instanceof ErrorBase) {
            // eslint-disable-next-line no-console
            console.error("Shutdown started by exception:");
            // eslint-disable-next-line no-console
            console.error(signal);
        }

        // It's helpful to see service lifecycle events in production logs. All logging
        // in response to user actions should go to Honeycomb.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(`Shutdown started (pid: ${process.pid})`);
        }

        if (
            this._ingressTrafficListeners.size === 0 &&
            this._listeners.size === 0 &&
            this._waitUntilPromises.size === 0
        ) {
            // It's helpful to see service lifecycle events in production logs. All logging
            // in response to user actions should go to Honeycomb.
            if (process.env.NODE_ENV === "production") {
                // eslint-disable-next-line no-console
                console.log(`Shutdown finished (pid: ${process.pid})`);
            }

            finishSpan();
            process.exit(signal instanceof ErrorBase ? 1 : 0);
        } else {
            const ingressTrafficShutdownPromise = runAllPromises(
                Array.from(this._ingressTrafficListeners, listener => listener(signal, span)),
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
                    runAllPromises(Array.from(this._listeners, listener => listener(signal, span))),
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
                    let hasError = false;
                    let errorPriority = 0;
                    let error: unknown;

                    // Wait for all promises to resolve. If there's an error, don't throw it until
                    // all promises have resolved.
                    const wait = async () => {
                        while (this._waitUntilPromises.size > 0) {
                            try {
                                await runAllPromises(this._waitUntilPromises);
                            } catch (newError) {
                                const newErrorPriority = getAggregateErrorPriority(newError);

                                if (!hasError) {
                                    hasError = true;
                                    errorPriority = newErrorPriority;
                                    error = newError;
                                }
                                // TODO(calebmer, #aggregate-error): Log all rejections in our telemetry, not
                                // just the first one. Probably by using an `AggregateError`.
                                else if (newErrorPriority > errorPriority) {
                                    errorPriority = newErrorPriority;
                                    error = newError;
                                }
                            }
                        }
                    };

                    await span.withSpan(
                        "Waiting for remaining process promises",
                        async childSpan => {
                            await wait();
                            if (hasError) childSpan.addException(error);
                        },
                    );

                    if (!hasAddedExceptionToSpan && hasError) {
                        hasAddedExceptionToSpan = true;
                        span.addException(error);
                    }

                    finishSpan();

                    // After we finish the span, we need to wait for all `waitUntil()` promises
                    // AGAIN since we need to send shutdown spans to our telemetry provider
                    // (Honeycomb) and our code to do this passes the telemetry request promise
                    // to `waitUntil()`.
                    await wait();

                    if (hasError) throw error;
                });

            const fullShutdownPromise = runAllPromises([
                ingressTrafficShutdownPromise,
                shutdownPromise,
                waitUntilShutdownPromise,
            ]);

            fullShutdownPromise.then(
                () => {
                    // It's helpful to see service lifecycle events in production logs. All logging
                    // in response to user actions should go to Honeycomb.
                    if (process.env.NODE_ENV === "production") {
                        // eslint-disable-next-line no-console
                        console.log(`Shutdown finished (pid: ${process.pid})`);
                    }

                    process.exit(signal instanceof ErrorBase ? 1 : 0);
                },
                error => {
                    // It's helpful to see service lifecycle events in production logs. All logging
                    // in response to user actions should go to Honeycomb.
                    if (process.env.NODE_ENV === "production") {
                        // eslint-disable-next-line no-console
                        console.log(`Shutdown finished (pid: ${process.pid})`);
                    }

                    // eslint-disable-next-line no-console
                    console.error("Shutdown finished with exception:");
                    // eslint-disable-next-line no-console
                    console.error(error);

                    process.exit(1);
                },
            );
        }
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
        listener: (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>,
    ): () => void {
        assert(!this._isShuttingDown);

        const actualListener: typeof listener = (signal, parentSpan) => {
            return parentSpan.withSpan(name, span => listener(signal, span));
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
        listener: (signal: "SIGINT" | "SIGTERM" | ErrorBase, span: TracerSpan) => Promise<void>,
    ): () => void {
        assert(!this._isShuttingDown);

        const actualListener: typeof listener = (signal, parentSpan) => {
            return parentSpan.withSpan(name, span => listener(signal, span));
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
