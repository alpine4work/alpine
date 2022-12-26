import {ErrorBase} from "~/shared/error/error";
import {ErrorCode, getErrorCodeName} from "~/shared/error/error_code";
import {assert} from "~/shared/helpers/control/assert";
import {LinkedList, NonEmptyLinkedList} from "~/shared/helpers/immutable/linked_list";
import {Id, generateId} from "~/shared/id/id";
import {getRealmId} from "~/shared/id/realm_id";
import {mergeTracerEventData} from "~/shared/tracer/merge_tracer_event_data";
import {TracerEvent} from "~/shared/tracer/tracer_event";
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
// - Unhandled errors on the client and server
// - Only allow propagating some data. Should error if client tries to
//   propagate more
// - Maybe in Cloudflare workers, whenever `getTime` is called we should do
//   some light IO to progress the time? Maybe a cache read or something?

/**
 * An object you can create new spans from. These spans may be child of other
 * spans or may be root-level spans.
 */
export abstract class TracerBase {
    /**
     * Start a span that you will manually finish. We recommend using `withSpan()`
     * wherever possible which automatically finishes spans and handles exceptions.
     *
     * See `withSpan()` on guidance for naming spans.
     */
    public abstract startSpan(name: string): {span: TracerSpan; finishSpan: () => void};

    /**
     * Runs some code with a span around it. Tracks the time the span takes to
     * execute and exceptions that happen while executing. You can add more data to
     * the span (including child spans) through the provided `span` argument.
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
    public async withSpan<Value>(
        name: string,
        action: (span: TracerSpan) => Promise<Value>,
    ): Promise<Value> {
        const {span, finishSpan} = this.startSpan(name);
        try {
            const value = await action(span);
            finishSpan();
            return value;
        } catch (error) {
            span.addException(error, {escaped: true});
            finishSpan();
            throw error;
        }
    }

    /**
     * Returns a tracer where all spans created by the tracer will include the data
     * passed into this function. The propagated data will also be sent over
     * network boundaries.
     *
     * If this tracer is, itself, a span then we will add this data to the span
     * itself and all future child spans (not just child spans created by the
     * returned object). When we add propagated data through mutation (instead of
     * creating a new immutable object) then the returned object will be
     * referentially equal to `this`.
     *
     * Regardless of the implementation, this function guarantees that spans
     * created by the returned tracer will have the propagated data.
     */
    public abstract withPropagatedData(data: TracerEventData): TracerBase;
}

/**
 * We instrument our code with distributed tracing. Each process has a tracer
 * object which you can create new traces from. To start a trace you create a new
 * root span from the tracer object with the `withSpan()` function.
 */
export class Tracer extends TracerBase {
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
        getTime,
        sendEvent,
    }: {
        serviceName: TracerServiceName;
        jsHost: TracerEventJsHost;
        getTime: () => number;
        sendEvent: (event: TracerEvent) => void;
    }) {
        return new Tracer({
            getTime,
            sendEvent,
            sharedEventData: {
                service: {
                    name: serviceName,
                },
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
     * Clone this tracer with some new propagated data. Propagated data will be
     * added to all root child spans created by the returned tracer. Propagated
     * data will not be added to previously created spans.
     *
     * Propagated data will also be propagated across process boundaries. So if we
     * make an HTTP request then we send our propagated data with us.
     */
    public withPropagatedData(data: TracerEventData): Tracer {
        return new Tracer({
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
}

/**
 * A distributed tracing span.
 *
 * Very close to [OpenTelemetry][1] spans but simpler and with a
 * few customizations.
 *
 * [1]: https://opentelemetry.io
 */
export class TracerSpan extends TracerBase {
    /**
     * The ID of the trace this span is in.
     */
    public readonly traceId: Id;

    /**
     * This span's ID.
     */
    public readonly spanId: Id;

    /**
     * The time at which the span started.
     */
    private readonly _startTime: number;

    /**
     * Has the span finished? Once the span is finished it will be sent so you
     * can't add more data.
     */
    private _finished = false;

    /**
     * We collect span data in a linked list that we merge into a single document
     * only when we send to our telemetry service. That way we don't need to do an
     * object clone for every span. Arguably a premature optimization.
     */
    private _eventData: NonEmptyLinkedList<TracerEventFullData>;

    /**
     * Data that is propagated to all child spans and across process boundaries.
     */
    private _propagatedEventData: LinkedList<TracerEventData>;

    private constructor(
        // TODO(calebmer): I'm thinking about recommending against and linting against
        // properties of this style. Leads to classes that are hard to maintain.
        private readonly _tracer: Tracer,
        public readonly name: string,
        parentSpan: TracerSpan | null,
    ) {
        super();

        assert(!parentSpan || this._tracer === parentSpan._tracer);

        this.traceId = parentSpan?.traceId ?? generateId();
        this.spanId = generateId();
        this._startTime = this._tracer.getTime();
        this._propagatedEventData =
            parentSpan?._propagatedEventData ??
            (this._tracer.propagatedEventData
                ? {value: this._tracer.propagatedEventData, next: null}
                : null);

        this._eventData = {
            value: {
                name,
                trace: {
                    traceId: this.traceId,
                    spanId: this.spanId,
                    parentId: parentSpan?.spanId,
                },
            },
            next: {
                value: this._tracer.sharedEventData,
                next: this._propagatedEventData,
            },
        };
    }

    public static _start(tracer: Tracer, name: string, parentSpan: TracerSpan | null) {
        const span = new TracerSpan(tracer, name, parentSpan);
        const finishSpan = () => span._finish();
        return {span, finishSpan};
    }

    public startSpan(name: string) {
        return TracerSpan._start(this._tracer, name, this);
    }

    /**
     * Has the span finished?
     */
    public isFinished() {
        return this._finished;
    }

    /**
     * Add some data to this span.
     *
     * Nested objects are recursively merged in.
     */
    public addData(data: TracerEventData) {
        assert(!this._finished);

        this._eventData = {
            value: data,
            next: this._eventData,
        };
    }

    /**
     * Add an exception to the span's data. Puts the span in an error state.
     */
    public addException(
        error: unknown,
        {
            escaped,
        }: {
            /** Has this error escaped the scope of the span? */
            escaped: boolean;
        },
    ) {
        const errorCode = error instanceof ErrorBase ? error.code : ErrorCode.Unknown;

        this.addData({
            exception: {
                escaped,
                message: error instanceof Error ? error.message : undefined,
                stacktrace: error instanceof Error ? error.stack : undefined,
                type: `${getErrorCodeName(errorCode)}Error`,
            },
        });
    }

    /**
     * Add some data to this span and all child spans created after this function
     * call. We also send this data over the network so that spans in distributed
     * services also add our propagated data.
     *
     * We will not added this propagated data to spans created before this
     * function call.
     */
    public addPropagatedData(data: TracerEventData) {
        assert(!this._finished);

        this._eventData = {
            value: data,
            next: this._eventData,
        };
        this._propagatedEventData = {
            value: data,
            next: this._propagatedEventData,
        };
    }

    /**
     * Implementation of `TracerBase.withPropagatedData()`. Directly calls
     * `TracerSpan.addPropagatedData()`.
     */
    public withPropagatedData(data: TracerEventData): TracerSpan {
        this.addPropagatedData(data);
        return this;
    }

    /**
     * Finishes the span. Finished spans will be sent to our observability service.
     */
    private _finish() {
        assert(!this._finished);

        const endTime = this._tracer.getTime();

        this._eventData = {
            value: {durationMs: endTime - this._startTime},
            next: this._eventData,
        };

        this._tracer.sendEvent(new TracerEvent(this._startTime, this._eventData));
    }

    /**
     * Usually it's enough to express span relationships as parent/child
     * relationships. However, sometimes you have causal relationships between
     * spans that don't have a clean parent/child relationship. For example batch
     * processing from many spans. You may use the link function to express a
     * causal relationship between these spans.
     */
    public link(span: Omit<TracerSpan, "finish">) {
        const time = this._tracer.getTime();

        // Link this span with another using the Honeycomb link event format:
        // https://docs.honeycomb.io/getting-data-in/tracing/send-trace-data/#links
        const data: TracerEventFullData = {
            meta: {annotationType: "link"},
            trace: {
                parentId: this.spanId,
                traceId: this.traceId,
                link: {
                    spanId: span.spanId,
                    traceId: span.traceId,
                },
            },
        };

        this._tracer.sendEvent(new TracerEvent(time, {value: data, next: null}));
    }
}
