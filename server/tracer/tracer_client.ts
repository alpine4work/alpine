import {KinesisClient, KinesisPutRecordsRequestEntry} from "~/server/kinesis/kinesis_client.js";
import {
    DataLossError,
    InternalError,
    UnavailableError,
    UnknownError,
} from "~/shared/error/error.open_source.js";
import {debugRedactedString} from "~/shared/error/render_debug_error_display_message.open_source.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {DateString, serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data.open_source.js";
import {
    TracerEvent,
    convertTracerEventFlatDataToKinesisData,
} from "~/shared/tracer/tracer_event.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";

export type HoneycombDataset =
    | "tracer"
    | "lifecycle"
    | "resource-service"
    | "local-redirect-service";

/**
 * Client we use for sending our tracer events to Honeycomb.
 */
export class TracerClient {
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

    /**
     * The Honeycomb dataset we are sending events to.
     */
    private readonly _dataset: HoneycombDataset;

    /**
     * The Kinesis client we use for sending events to Kinesis.
     */
    private readonly _kinesis: KinesisClient | undefined;

    private _scheduledEventBatch: {
        events: Array<TracerEvent>;
        flush: () => Promise<void>;
    } | null = null;

    constructor({
        apiKey,
        tracer,
        dataset,
        waitUntil,
        kinesis,
    }: {
        apiKey: string;
        tracer: TracerRoot;
        dataset: HoneycombDataset;
        waitUntil: (promise: Promise<void>) => void;
        // TODO(ifitzsimmons, ##local-kinesis): In order to convert our log architecture
        // such that all events go through Kinesis and are then forwarded to Honeycomb, we
        // need to figure out how to represent this in our local environment. In the
        // meantime, we are only using Kinesis to get our log data into S3, so this process
        // is only necessary in production.
        kinesis?: KinesisClient;
    }) {
        this._apiKey = apiKey;
        this._tracer = tracer;
        this._dataset = dataset;
        this._waitUntil = waitUntil;
        this._kinesis = kinesis;
    }

    /**
     * Sends a single event to Honeycomb. Will group together events which ocurred in a
     * short window of time and send them together in a batch.
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
                const timeoutPromiseResolver = createPromiseResolver();
                const timeout = createTimeout(timeoutPromiseResolver.resolve, 500);

                // We send events in a batch to Honeycomb twice a second. We want the delay to be
                // long enough to include a meaningful amount of data but also short enough that
                // it's tolerable to delay process shutdown by this duration. However, if flush()
                // is called, we bypass the timeout.
                try {
                    await Promise.race([
                        timeoutPromiseResolver.promise,
                        flushPromiseResolver.promise,
                    ]);
                } finally {
                    timeout.clear();
                }

                // Clear so the next `sendEvent()` schedules a new event batch.
                this._scheduledEventBatch = null;

                const eventsWithFlatData = events.map(event => ({
                    time: event.time,
                    data: event.getFlatData(),
                }));

                await runAllPromises([
                    sendTracerEventsToHoneycomb(
                        this._apiKey,
                        this._dataset,
                        eventsWithFlatData.map(event => ({
                            time: serializeDateString(new Date(event.time)),
                            data: event.data,
                        })),
                    ),
                    // TODO(ifitzsimmons, #local-kinesis): In order to convert our log architecture
                    // such that all events go through Kinesis and are then forwarded to Honeycomb, we
                    // need to figure out how to represent this in our local environment. In the
                    // meantime, we are only using Kinesis to get our log data into S3, so this process
                    // is only necessary in production.
                    this._kinesis
                        ? sendTracerEventsToKinesis(
                              this._kinesis,
                              eventsWithFlatData.map(
                                  (event): KinesisPutRecordsRequestEntry => ({
                                      data: convertTracerEventFlatDataToKinesisData(event),
                                      partitionKey:
                                          (event.data["trace.trace_id"] as string | undefined) ??
                                          (event.data["trace.span_id"] as string | undefined) ??
                                          generateId(),
                                  }),
                              ),
                          )
                        : null,
                ]);
            })().catch(error => {
                throw DataLossError.from(error, "Failed to tracer send event batch");
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
     * Flushes the scheduled event batch immediately, foregoing the 500ms batch
     * interval.
     */
    public async flushScheduledEventBatch(): Promise<void> {
        // NOTE(ifitzsimmons, 2025-08-06): Previously, we registered `waitUntil()` promises
        // with the process shutdown manager to ensure that any pending Honeycomb event
        // batches were sent before the process exited. This approach assumed we controlled
        // the process lifecycle.
        //
        // However, we don't always control the process. For example, AWS Lambda enforces
        // its own timeout and terminates the process when the limit is reached. In such
        // cases, we need a mechanism to flush the event batch before the process exits. If
        // no batch is scheduled, nothing to flush
        if (this._scheduledEventBatch === null) return;
        await this._scheduledEventBatch.flush();
    }

    /**
     * [Create a marker][1] in Honeycomb. The API key must have the "manage markers"
     * permission level. Useful for highlighting in Honeycomb when deploys occur.
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
        // eslint-disable-next-line cyberworlds/no-global-fetch
        const response = await fetch("https://api.honeycomb.io/1/markers/__all__", {
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
            const message = `Couldn\u2019t create Honeycomb marker${
                isObject(body) && typeof body.error === "string" ? `: ${body.error}` : ""
            } (status code: ${response.status})`;

            // 5xx errors are transient and should be retried. 4xx errors are our fault.
            if (response.status >= 500) {
                throw new UnavailableError(message);
            } else {
                throw new UnknownError(message);
            }
        }
    }
}

export async function sendTracerEventsToHoneycomb(
    apiKey: string,
    dataset: HoneycombDataset,
    events: Array<{time: DateString; data: TracerEventFlatData}>,
) {
    try {
        await retryWithExponentialBackoff(async retry => {
            try {
                let bodyString = JSON.stringify(events);

                // Detect `?sig=` URL search params and redact them before sending events to
                // Honeycomb. `?sig=` parameters would allow a developer to look at any users files
                // without their permission just by looking at logs. The value of `?sig=` is a
                // detached JWS (see `dangerouslySignUrl()`). So look for any base64 characters or
                // `.`.
                //
                // Also if we see an [AWS S3 signed URL][1] we want to redact the amazon signature.
                //
                // [1]:
                //     https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
                bodyString = bodyString.replaceAll(
                    /([?&](?:sig|X-Amz-Signature)=)[A-Za-z0-9+/\-_=.]+/gi,
                    `$1${debugRedactedString}`,
                );

                // eslint-disable-next-line cyberworlds/no-global-fetch
                const response = await fetch(`https://api.honeycomb.io/1/batch/${dataset}`, {
                    method: "POST",
                    headers: {
                        "x-honeycomb-team": apiKey,
                        "content-type": "application/json",
                    },
                    body: bodyString,
                });

                if (response.status >= 400) {
                    retry(
                        new InternalError(
                            `Honeycomb batch request failed (status code: ${response.status})`,
                        ),
                    );
                    return;
                }

                const eventResponses: Array<{status: number; error?: string}> =
                    await response.json();
                for (const eventResponse of eventResponses) {
                    if (eventResponse.status >= 400) {
                        // TODO(ifitzsimmons): Set up CloudWatch alerts that notify us when
                        // it sees `DataLossError`s.
                        // eslint-disable-next-line no-console
                        console.error(
                            new DataLossError(
                                `Failed to send tracer event to Honeycomb${
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
    } catch (error) {
        // TODO(ifitzsimmons): Set up CloudWatch alerts that notify us when
        // it sees `DataLossError`s.
        // eslint-disable-next-line no-console
        console.error(DataLossError.from(error, "Failed to send tracer event batch to Kinesis"));
    }
}

export async function sendTracerEventsToKinesis(
    kinesis: KinesisClient,
    kinesisRecords: Array<KinesisPutRecordsRequestEntry>,
) {
    try {
        await retryWithExponentialBackoff(async retry => {
            try {
                const result = await kinesis.PutRecords(kinesisRecords);

                if (result.failedRecordCount > 0) {
                    for (const record of result.records) {
                        if (!record.errorCode) continue;

                        // TODO(ifitzsimmons): Set up CloudWatch alerts that notify us when
                        // it sees `DataLossError`s.
                        // eslint-disable-next-line no-console
                        console.error(
                            new DataLossError(
                                `Failed to send tracer event to Kinesis${
                                    record.errorMessage ? `: ${record.errorMessage}` : ""
                                } (error code: ${record.errorCode})`,
                            ),
                        );
                    }
                }
            } catch (error) {
                retry(error);
            }
        });
    } catch (error) {
        // TODO(ifitzsimmons): Set up CloudWatch alerts that notify us when
        // it sees `DataLossError`s.
        // eslint-disable-next-line no-console
        console.error(DataLossError.from(error, "Failed to send tracer event batch to Kinesis"));
    }
}
