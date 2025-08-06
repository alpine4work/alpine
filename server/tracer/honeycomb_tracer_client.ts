import {DataLossError, UnknownError} from "~/shared/error/error.js";
import {debugRedactedString} from "~/shared/error/render_debug_error_display_message.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
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

    private _scheduledEventBatch: {
        events: Array<TracerEvent>;
        flush: () => Promise<void>;
    } | null = null;

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
            const events: Array<TracerEvent> = [];
            const flushPromiseResolver = createPromiseResolver();

            this._scheduledEventBatch = {
                events,
                flush: () => {
                    flushPromiseResolver.resolve();
                    return promise;
                },
            };

            const promise = (async () => {
                // We send events in a batch to Honeycomb twice a second. We want the
                // delay to be long enough to include a meaningful amount of data but also
                // short enough that it's tolerable to delay process shutdown by this duration.
                // However, if flush() is called, we bypass the timeout.
                await Promise.race([wait(500), flushPromiseResolver.promise]);

                // Clear so the next `sendEvent()` schedules a new event batch.
                this._scheduledEventBatch = null;

                await retryWithExponentialBackoff(async retry => {
                    try {
                        let bodyString = JSON.stringify(
                            events.map(event => ({
                                time: new Date(event.time).toISOString(),
                                data: event.getFlatData(),
                            })),
                        );

                        // Detect `?sig=` URL search params and redact them before sending events to
                        // Honeycomb. `?sig=` parameters would allow a developer to look at any users
                        // files without their permission just by looking at logs. The value of `?sig=`
                        // is a detached JWS (see `dangerouslySignShortLivedUrl()`). So look for any
                        // base64 characters or `.`.
                        //
                        // Also if we see an [AWS S3 signed URL][1] we want to redact the amazon
                        // signature.
                        //
                        // [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
                        bodyString = bodyString.replaceAll(
                            /([?&](?:sig|X-Amz-Signature)=)[A-Za-z0-9+/\-_=.]+/gi,
                            `$1${debugRedactedString}`,
                        );

                        // eslint-disable-next-line no-global-fetch
                        const response = await fetch("https://api.honeycomb.io/1/batch/tracer", {
                            method: "POST",
                            headers: {
                                "x-honeycomb-team": this._apiKey,
                                "content-type": "application/json",
                            },
                            body: bodyString,
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
                                this._tracer.logException(
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

        this._scheduledEventBatch.events.push(event);
    }

    /**
     * Flushes the scheduled event batch immediately, foregoing the 500ms batch interval.
     */
    public async flushScheduledEventBatch(): Promise<void> {
        // NOTE(ifitzsimmons, 2025-08-06): Previously, we registered `waitUntil()` promises with the
        // process shutdown manager to ensure that any pending Honeycomb event batches were sent before
        // the process exited. This approach assumed we controlled the process lifecycle.
        //
        // However, we don't always control the process. For example, AWS Lambda enforces its own
        // timeout and terminates the process when the limit is reached. In such cases, we need a
        // mechanism to flush the event batch before the process exits.
        // If no batch is scheduled, nothing to flush
        if (this._scheduledEventBatch === null) return;
        await this._scheduledEventBatch.flush();
    }

    /**
     * [Create a marker][1] in Honeycomb. The API key must have the "manage
     * markers" permission level. Useful for highlighting in Honeycomb when
     * deploys occur.
     *
     * [1]: https://docs.honeycomb.io/api/tag/Markers#operation/createMarker
     */
    public async createMarker({
        type,
        message,
        url,
        startTime,
        endTime,
    }: {
        type?: string;
        message?: string;
        url?: string;
        startTime: Date;
        endTime?: Date;
    }) {
        // eslint-disable-next-line no-global-fetch
        const response = await fetch("https://api.honeycomb.io/1/markers/tracer", {
            method: "POST",
            headers: {
                "x-honeycomb-team": this._apiKey,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                type,
                message,
                url,
                start_time: Math.round(startTime.getTime() / 1000),
                end_time: endTime !== undefined ? Math.round(endTime.getTime() / 1000) : undefined,
            }),
        });

        const body = await response.json();

        if (response.status !== 201) {
            throw new UnknownError(
                `Couldn’t create Honeycomb marker${
                    isObject(body) && typeof body.error === "string" ? `: ${body.error}` : ""
                } (status code: ${response.status})`,
            );
        }
    }
}
