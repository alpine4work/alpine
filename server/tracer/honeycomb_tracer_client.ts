import {DataLossError} from "~/shared/error/error";
import {wait} from "~/shared/helpers/async/wait";
import {TracerEvent} from "~/shared/tracer/tracer_event";
import {TracerRoot} from "~/shared/tracer/tracer_root";

/**
 * Client we use for sending our tracer events to Honeycomb.
 */
export class HoneycombTracerClient {
    /**
     * The API key we use for communicating with Honeycomb.
     */
    private readonly _apiKey: string;

    /**
     * If there was an error sending events to Honeycomb, we will log an
     * exception. The exception event will be sent right back to our Honeycomb
     * client. We may get stuck in an error loop if we absolutely can't communicate
     * with Honeycomb.
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

            this._waitUntil(
                (async () => {
                    // We send events in a batch to Honeycomb every second.
                    await wait(1000);

                    const eventBatch = this._scheduledEventBatch;
                    this._scheduledEventBatch = null;
                    if (eventBatch === null) return;

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
                            this._tracer.logUncaughtException(
                                "Failed to send event batch to Honeycomb",
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
                        this._tracer.logUncaughtException(
                            "Failed to send event batch to Honeycomb",
                            DataLossError.from(error, "Failed to send event batch to Honeycomb"),
                        );
                    }
                })(),
            );
        }

        this._scheduledEventBatch.push(event);
    }
}
