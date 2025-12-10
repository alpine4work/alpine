import {getErrorOriginalTracerSpan} from "~/shared/error/error_original_tracer_span.js";
import {Clock} from "~/shared/helpers/clock/clock.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getRealmId} from "~/shared/id/realm_id.js";
import {getTracerEventExceptionData} from "~/shared/tracer/helpers/get_tracer_event_exception_data.js";
import {mergeTracerEventData} from "~/shared/tracer/helpers/merge_tracer_event_data.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";
import {TracerSpan, TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.js";
import {
    TracerEventData,
    TracerEventFullData,
    TracerEventJsHost,
} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * The name of the service our tracer is for.
 *
 * The "Test" service is a generic service we use for executing unit tests.
 * Usually the tests are executed with Jest.
 *
 * ## How to decide when to add a new service
 *
 * We do not consider ourselves a microservice shop. Yet we still have a number
 * of different services. We prefer unified frameworks and shared
 * infrastructure wherever possible.
 *
 * You should only create a new service when it makes _physical_ sense not
 * _logical_ sense.
 *
 * What does that mean? A logical justification for a new service is "we're
 * building out a new calendar feature which has its own database, lets put it
 * in a separate service". This is a logical justification since it's based on
 * the new logic being different from what we currently have. A physical
 * justification for a new service is "our video conferencing feature is CPU
 * intensive and starving other code so let's move it to a separate service".
 *
 * A new service makes physical sense when there are physical constraints (CPU,
 * memory, cores, GPU, scale, stateful vs stateless) that are different from
 * our current services.
 *
 * Some examples from our current services:
 *
 * - All stateless request/response logic should go in `AppService`.
 *   `AppService` is optimized for this workload.
 * - Each kind of durable object has unique internal state and is
 *   scaled/deployed separately by Cloudflare so individual durable objects
 *   have their own services.
 * - `TaskRealtimeService` is a stateful service that needs to live in AWS so
 *   it's physically close to DynamoDB and OpenSearch. Spaces are routed to
 *   individual cores within our `TaskRealtimeService` fleet.
 */
export type TracerServiceName =
    // Generic name for admin scripts in the `admin` directory.
    | "Admin"
    // Generic name for Jest unit tests and Playwright integration tests.
    | "Test"

    // Our actual services:
    | "MigrationService"
    | "DeployService"
    | "OpensearchDeployScript"
    | "AppClient"
    | "AppService"
    | "EdgeService"
    | "TaskRealtimeService"
    | "JobQueueService"
    | "FileProcessorService"
    | "ApiService"
    | "AgentService"
    | "ChatGptAgentService"
    | "ResourceService"
    | DurableObjectServiceName;

/**
 * The names of services that run as Cloudflare Durable Objects.
 */
export type DurableObjectServiceName =
    | "DocumentCollaborationService"
    | "PostRealtimeService"
    | "ChannelRealtimeService"
    | "ChatRealtimeService"
    | "MyAccountService"
    | "TaskNotesCollaborationService";

// TODO(calebmer, #tracer): Tracer stuff
// - Apply source map to error stack trace on server
// - Redact URLs
// - Add [Refinery tail-based sampling](https://docs.honeycomb.io/manage-data-volume/refinery/)
// - When we add sampling, send all events to Redshift for more complete
//   analysis

/**
 * We instrument our code with distributed tracing. Each process has a tracer
 * object which you can create new traces from. To start a trace you create a new
 * root span from the tracer object with the `withSpan()` function.
 */
export class TracerRoot extends TracerBase {
    public readonly serviceName: TracerServiceName;

    /**
     * The base clock we use for measuring span time. When we start a span, we
     * create a new `MonotonicClock` so durations are high resolution (when
     * available) and not subject to system clock adjustments.
     */
    private readonly _clock: Clock;

    /**
     * Send an event to our observability tool for storage and analysis.
     *
     * This is private, only code that's part of the tracer implementation can call
     * it. We do have some callers outside of this class. So while we give it a
     * private name as an underscore, we label it as `public` with TypeScript.
     */
    public readonly _sendEvent: (event: TracerEvent) => void;

    /**
     * Event data shared across all spans created by this tracer.
     *
     * Different from propagated data in that it's not propagated across network
     * boundaries. It only applies to this process.
     */
    public readonly sharedEventData: TracerEventFullData;

    /**
     * Event data shared across all spans created by this tracer and propagated
     * across network boundaries to spans in other processes.
     */
    public readonly propagatedEventData: TracerEventData | null;

    private constructor({
        serviceName,
        clock,
        sendEvent,
        sharedEventData,
        propagatedEventData,
    }: {
        serviceName: TracerServiceName;
        clock: Clock;
        sendEvent: (event: TracerEvent) => void;
        sharedEventData: TracerEventFullData;
        propagatedEventData: TracerEventData | null;
    }) {
        super();
        this.serviceName = serviceName;
        this._clock = clock;
        this._sendEvent = sendEvent;
        this.sharedEventData = sharedEventData;
        this.propagatedEventData = propagatedEventData;
    }

    public static new({
        serviceName,
        jsHost,
        untrusted,
        clock,
        sendEvent,
    }: {
        serviceName: TracerServiceName;
        jsHost: TracerEventJsHost;
        untrusted: boolean;
        clock: Clock;
        sendEvent: (event: TracerEvent) => void;
    }) {
        return new TracerRoot({
            serviceName,
            clock,
            sendEvent,
            sharedEventData: {
                service: {
                    name: serviceName,
                },
                ...(untrusted ? {meta: {untrusted}} : {}),
                js: {
                    realmId: getRealmId(),
                    host: jsHost,
                    nodeEnv: assertExists(
                        process.env.NODE_ENV,
                        "`NODE_ENV` environment variable is not set",
                    ),
                },
            },
            propagatedEventData: null,
        });
    }

    public getNonMonotonicClock() {
        return this._clock;
    }

    public getRoot(): TracerRoot {
        return this;
    }

    public startSpan(name: string) {
        return TracerSpan._start(this, new MonotonicClock(this._clock), name, null);
    }

    public startSpanAsLinked(name: string) {
        return this.startSpan(name);
    }

    /**
     * Start a span from the propagation context object returned by `TracerSpan`.
     * The propagation context is serialized over the network by, for instance,
     * HTTP header.
     */
    public startSpanFromPropagationContext(
        name: string,
        propagationContext: TracerSpanPropagationContext,
    ) {
        return TracerSpan._start(this, new MonotonicClock(this._clock), name, {
            traceId: propagationContext.traceId,
            parentId: propagationContext.parentId,
            propagatedEventFlatData: propagationContext.data,
        });
    }

    /**
     * Start a span from the propagation context object returned by `TracerSpan`.
     * But instead of setting the span as a parent, instead link the span.
     */
    public startSpanFromPropagationContextAsLinked(
        name: string,
        propagationContext: TracerSpanPropagationContext,
    ) {
        const {span, finishSpan} = TracerSpan._start(this, new MonotonicClock(this._clock), name, {
            propagatedEventFlatData: propagationContext.data,
        });

        span.link(`Parent of: ${name}`, {
            traceId: propagationContext.traceId,
            spanId: propagationContext.parentId,
        });

        return {span, finishSpan};
    }

    /**
     * Same as `withSpan()` but internally calls
     * `startSpanFromPropagationContext()` to start the span instead of
     * `startSpan()`. See the documentation on `withSpan()` for more information.
     */
    public async withSpanFromPropagationContext<Value>(
        name: string,
        propagationContext: TracerSpanPropagationContext,
        action: (span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        const {span, finishSpan} = this.startSpanFromPropagationContext(name, propagationContext);
        try {
            const value = await action(span);
            finishSpan();
            return value;
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }

    /**
     * Clone this tracer with some new propagated data. Propagated data will be
     * added to all root child spans created by the returned tracer. Propagated
     * data will not be added to previously created spans.
     *
     * Propagated data will also be propagated across process boundaries. So if we
     * make an HTTP request then we send our propagated data with us.
     */
    public withPropagatedData(data: TracerEventData): TracerRoot {
        return new TracerRoot({
            serviceName: this.serviceName,
            clock: this._clock,
            sendEvent: this._sendEvent,
            sharedEventData: this.sharedEventData,
            propagatedEventData: this.propagatedEventData
                ? // We merge here instead of using a linked list we lazily merge later since we
                  // expect `withPropagatedData()` to not be in hot code paths. Unlike
                  // `addData()`.
                  mergeTracerEventData([this.propagatedEventData, data])
                : data,
        });
    }

    /**
     * Clone this tracer with some new propagated data. Propagated data will be
     * added to all root child spans created by the returned tracer. Propagated
     * data will not be added to previously created spans.
     *
     * Propagated data will also be propagated across process boundaries. So if we
     * make an HTTP request then we send our propagated data with us.
     *
     * Calling this method will ignore any propagated data previously in the
     * tracer! Use `withPropagatedData()` to merge propagated data with the
     * existing propagated data instead. Generally prefer using
     * `withPropagatedData()` so you don't lose data.
     */
    public withReplacedPropagatedData(data: TracerEventData): TracerRoot {
        return new TracerRoot({
            serviceName: this.serviceName,
            clock: this._clock,
            sendEvent: this._sendEvent,
            sharedEventData: this.sharedEventData,
            propagatedEventData: data,
        });
    }

    /**
     * See documentation for this method on `TracerBase.log()`.
     */
    public log(name: string, data: TracerEventData = {}) {
        const time = this._clock.now();

        this._sendEvent(
            new TracerEvent(
                time,
                {
                    value: data,
                    next: {
                        // Add this event to a span using the Honeycomb span event format:
                        // https://docs.honeycomb.io/getting-data-in/tracing/send-trace-data/#span-events
                        value: {
                            name,
                        },
                        next: {
                            value: this.sharedEventData,
                            next: this.propagatedEventData
                                ? {
                                      value: this.propagatedEventData,
                                      next: null,
                                  }
                                : null,
                        },
                    },
                },
                null,
            ),
        );
    }

    /**
     * Add a structured exception log event to this span.
     *
     * Uses `this.log()` but with exception event attributes.
     *
     * See `TracerBase.log` for how to name this event.
     */
    public logException(
        name: string,
        error: unknown,
        data: TracerEventData = {},
        {disableConsoleLog}: {disableConsoleLog?: boolean} = {},
    ) {
        // We don't normally log errors to the console in development because relevant
        // errors should be presented in the app to the developer inline where they
        // occurred. However, uncaught exceptions may not be associated with anything
        // in the app. So log uncaught exceptions in development.
        if (!disableConsoleLog && process.env.NODE_ENV !== "production") {
            const extra: {[key: string]: unknown} = {};

            if (error instanceof Error && error.cause) {
                extra.cause = error.cause;
            }

            if (error instanceof AggregateError) {
                extra.errors = error.errors;
            }

            if (Object.keys(extra).length === 0) {
                // eslint-disable-next-line no-console
                console.error(`${name}:`, error instanceof Error ? error.stack : error);
            } else {
                // eslint-disable-next-line no-console
                console.error(`${name}:`, error instanceof Error ? error.stack : error, extra);
            }
        }

        const originalSpan = getErrorOriginalTracerSpan(error);

        this.log(name, {
            ...data,
            exception: getTracerEventExceptionData(
                null,
                error,
                originalSpan ? {isOriginal: false, originalSpan} : {isOriginal: true},
            ),
        });
    }
}
