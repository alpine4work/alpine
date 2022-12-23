import {getRealmId} from "~/shared/id/realm_id";
import {TracerSpan} from "~/shared/tracer/tracer_span";
import {TracerEventFullData, TracerEventJsHost} from "~/shared/tracer/types/tracer_event_data";

export type TracerServiceName = "AppClient" | "AppServer";

// TODO(calebmer): Tracer stuff
// - Apply source map to error stack trace on server
// - Sample rate
// - Make sure client and server timestamps match
// - Redact URLs

export class Tracer {
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
     * Event data shared across all spans.
     */
    public readonly sharedEventData: TracerEventFullData;

    constructor({
        serviceName,
        jsHost,
        getTime,
    }: {
        serviceName: TracerServiceName;
        jsHost: TracerEventJsHost;
        getTime: () => number;
    }) {
        this.getTime = getTime;

        this.sharedEventData = {
            service: {
                name: serviceName,
            },
            js: {
                realmId: getRealmId(),
                host: jsHost,
            },
        };
    }

    /**
     * Start a new trace. The returned span will be at the root of our trace.
     *
     * The name should be a short, low cardinality, string. You should be able to
     * easily search the codebase for the code defining a span based on its name
     * after seeing a span in our observability tool.
     *
     * The name should not contain IDs or other dynamic content.
     *
     * We recommend formatting span names as short phrases without punctuation (but
     * can include spaces between words). For example: "Get admin account" is a
     * good span name.
     */
    public startRootSpan(name: string): TracerSpan {
        // We are ok with the tracer class creating a new span.
        return new (TracerSpan as any)(this, name);
    }
}
