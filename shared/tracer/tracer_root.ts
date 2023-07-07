import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getRealmId} from "~/shared/id/realm_id.js";
import {getExceptionTracerEventData} from "~/shared/tracer/helpers/get_exception_tracer_event_data.js";
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
 */
export type TracerServiceName =
    | "Adhoc"
    | "Test"
    | "AppClient"
    | "AppService"
    | "EdgeService"
    | DurableObjectServiceName;

/**
 * The names of services that run as Cloudflare Durable Objects.
 */
export type DurableObjectServiceName =
    | "DocumentCollaborationService"
    | "PostRealtimeService"
    | "ChatRealtimeService"
    | "MyAccountService";

// TODO(calebmer): Tracer stuff
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
    /**
     * Get the current time in milliseconds elapsed since the Unix epoch. Should be
     * monotonically increasing.
     *
     * `Date.now()` is a good starter implementation. However, in the browser it
     * may not monotonically increase since users can change their clock to any
     * value. A better implementation in the browser may use `performance.now()`.
     */
    public readonly getTime: () => number;

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
        getTime,
        sendEvent,
        sharedEventData,
        propagatedEventData,
    }: {
        getTime: () => number;
        sendEvent: (event: TracerEvent) => void;
        sharedEventData: TracerEventFullData;
        propagatedEventData: TracerEventData | null;
    }) {
        super();
        this.getTime = getTime;
        this._sendEvent = sendEvent;
        this.sharedEventData = sharedEventData;
        this.propagatedEventData = propagatedEventData;
    }

    public static new({
        serviceName,
        jsHost,
        untrusted,
        getTime,
        sendEvent,
    }: {
        serviceName: TracerServiceName;
        jsHost: TracerEventJsHost;
        untrusted: boolean;
        getTime: () => number;
        sendEvent: (event: TracerEvent) => void;
    }) {
        return new TracerRoot({
            getTime,
            sendEvent,
            sharedEventData: {
                service: {
                    name: serviceName,
                },
                ...(untrusted ? {meta: {untrusted}} : {}),
                js: {
                    realmId: getRealmId(),
                    host: jsHost,
                    nodeEnv: assertExists(process.env.NODE_ENV),
                },
            },
            propagatedEventData: null,
        });
    }

    public getRoot(): TracerRoot {
        return this;
    }

    public startSpan(name: string) {
        return TracerSpan._start(this, name, null);
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
        return TracerSpan._start(this, name, {
            traceId: propagationContext.traceId,
            parentId: propagationContext.parentId,
            propagatedEventFlatData: propagationContext.data,
        });
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
            getTime: this.getTime,
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
            getTime: this.getTime,
            sendEvent: this._sendEvent,
            sharedEventData: this.sharedEventData,
            propagatedEventData: data,
        });
    }

    /**
     * See documentation for this method on `TracerBase.log()`.
     */
    public log(name: string, data: TracerEventData = {}) {
        const time = this.getTime();

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
     *
     * We only have `this.logUncaughtException()` on the tracer root because Honeycomb
     * ignores exceptions on span events. It expects exceptions only on spans or
     * events outside of a span.
     */
    public logUncaughtException(
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
            // eslint-disable-next-line no-console
            console.error(error);
        }

        this.log(name, {
            ...data,
            exception: getExceptionTracerEventData(error),
        });
    }
}
