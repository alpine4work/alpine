import {DataLossError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

/**
 * Client we use for sending our tracer events to Honeycomb.
 */
export class HoneycombTracerClient {
    /**
     * The API key we use for communicating with Honeycomb.
     */
    private readonly _apiKey: string;

    /**
     * The tracer our Honeycomb client is sending events for. If there was an error
     * sending events to Honeycomb then we attempt to send an error event.
     */
    private readonly _tracer: TracerRoot;

    /**
     * Extends the lifetime of the process in a serverless runtime. For example
     * Cloudflare Workers.
     */
    private readonly _waitUntil: (promise: Promise<void>) => void;

    private _scheduledEventBatch: Array<TracerEvent> | null = null;

    constructor({
        apiKey,
        tracer,
        waitUntil,
    }: {
        apiKey: string;
        tracer: TracerRoot;
        waitUntil: (promise: Promise<void>) => void;
    }) {
        this._apiKey = apiKey;
        this._tracer = tracer;
        this._waitUntil = waitUntil;
    }

    /**
     * Sends a single event to Honeycomb. Will group together events which
     * ocurred in a short window of time and send them together in a batch.
     */
    public sendEvent(event: TracerEvent) {
        // If no event batch is scheduled, then schedule one now.
        if (this._scheduledEventBatch === null) {
            this._scheduledEventBatch = [];

            const promise = (async () => {
                // We send events in a batch to Honeycomb five times a second. We want the
                // delay to be long enough to include a meaningful amount of data but also
                // short enough that it's tolerable to delay process shutdown by this duration.
                await wait(200);

                const eventBatch = this._scheduledEventBatch;
                this._scheduledEventBatch = null;
                if (eventBatch === null) return;

                await retryWithExponentialBackoff(async retry => {
                    try {
                        // eslint-disable-next-line no-global-fetch
                        const response = await fetch("https://api.honeycomb.io/1/batch/tracer", {
                            method: "POST",
                            headers: {
                                "x-honeycomb-team": this._apiKey,
                                "content-type": "application/json",
                            },
                            body: JSON.stringify(
                                eventBatch.map(event => ({
                                    time: new Date(event.time).toISOString(),
                                    data: event.getFlatData(),
                                })),
                            ),
                        });

                        if (response.status >= 400) {
                            retry(
                                new DataLossError(
                                    `Failed to send event batch to Honeycomb (status code: ${response.status})`,
                                ),
                            );
                            return;
                        }

                        const eventResponses: Array<{status: number; error?: string}> =
                            await response.json();
                        for (const eventResponse of eventResponses) {
                            if (eventResponse.status >= 400) {
                                this._tracer.logUncaughtException(
                                    "Failed to send event to Honeycomb",
                                    new DataLossError(
                                        `Failed to send event to Honeycomb${
                                            eventResponse.error ? `: ${eventResponse.error}` : ""
                                        } (status code: ${eventResponse.status})`,
                                    ),
                                );
                            }
                        }
                    } catch (error) {
                        retry(error);
                    }
                });
            })().catch(error => {
                throw DataLossError.from(error, "Failed to send event batch to Honeycomb");
            });

            this._waitUntil(
                promise.catch(error => {
                    // `waitUntil()` errors will probably end up back in `sendEvent()`. So don't
                    // throw any errors from this promise. Instead log to the console.
                    //
                    // This is a pretty critical error. We should consider having some kind of
                    // backup alerting system if sending events to Honeycomb is failing?
                    //
                    // eslint-disable-next-line no-console
                    console.error(error);
                }),
            );
        }

        this._scheduledEventBatch.push(event);
    }
}
