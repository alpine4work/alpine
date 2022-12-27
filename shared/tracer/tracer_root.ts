import {getRealmId} from "~/shared/id/realm_id";
import {mergeTracerEventData} from "~/shared/tracer/helpers/merge_tracer_event_data";
import {TracerBase} from "~/shared/tracer/tracer_base";
import {TracerEvent} from "~/shared/tracer/tracer_event";
import {TracerSpan, TracerSpanPropagationContext} from "~/shared/tracer/tracer_span";
import {
    TracerEventData,
    TracerEventFullData,
    TracerEventJsHost,
} from "~/shared/tracer/types/tracer_event_data";

/**
 * The name of the service our tracer is for.
 */
export type TracerServiceName = "AppClient" | "AppServer" | "DocumentCollaborationService";

// TODO(calebmer): Tracer stuff
// - Apply source map to error stack trace on server
// - Sample rate
// - Make sure client and server timestamps match
// - Redact URLs
// - Maybe in Cloudflare workers, whenever `getTime` is called we should do
//   some light IO to progress the time? Maybe a cache read or something?

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
     */
    public readonly sendEvent: (event: TracerEvent) => void;

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
        this.sendEvent = sendEvent;
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
                },
            },
            propagatedEventData: null,
        });
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
            sendEvent: this.sendEvent,
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
     * See documentation for this method on `TracerBase.log()`.
     */
    public log(name: string, data: TracerEventData = {}) {
        const time = this.getTime();

        this.sendEvent(
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
}
