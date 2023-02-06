import {assert} from "~/shared/helpers/control/assert";
import {LinkedList, NonEmptyLinkedList} from "~/shared/helpers/immutable/linked_list";
import {generateId} from "~/shared/id/id";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types";
import {
    TracerEventFlatData,
    buildTracerEventFlatData,
} from "~/shared/tracer/helpers/build_tracer_event_flat_data";
import {getExceptionTracerEventData} from "~/shared/tracer/helpers/get_exception_tracer_event_data";
import {TracerBase} from "~/shared/tracer/tracer_base";
import {TracerEvent} from "~/shared/tracer/tracer_event";
import {TracerRoot} from "~/shared/tracer/tracer_root";
import {TracerEventData, TracerEventFullData} from "~/shared/tracer/types/tracer_event_data";

export type TracerSpanPropagationContext = {
    readonly traceId: TraceId;
    readonly parentId: TraceSpanId;
    readonly data: TracerEventFlatData;
};

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
    public readonly traceId: TraceId;

    /**
     * This span's ID.
     */
    public readonly spanId: TraceSpanId;

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

    /**
     * Flat data that was propagated to our span over the network. It may come from
     * a different programming language runtime so the data is in our network event
     * format instead of our nested object format.
     */
    private readonly _propagatedEventFlatData: TracerEventFlatData | null;

    private constructor(
        // TODO(calebmer): I'm thinking about recommending against and linting against
        // properties of this style. Leads to classes that are hard to maintain.
        private readonly _tracer: TracerRoot,
        public readonly name: string,
        parentSpan: {
            traceId: TraceId;
            parentId: TraceSpanId;
            propagatedEventData?: LinkedList<TracerEventData>;
            propagatedEventFlatData?: TracerEventFlatData | null;
        } | null,
    ) {
        super();

        this.traceId = parentSpan?.traceId ?? generateId();
        this.spanId = generateId();
        this._startTime = this._tracer.getTime();
        this._propagatedEventData = parentSpan
            ? parentSpan.propagatedEventData ?? null
            : this._tracer.propagatedEventData
            ? {value: this._tracer.propagatedEventData, next: null}
            : null;
        this._propagatedEventFlatData = parentSpan?.propagatedEventFlatData ?? null;

        this._eventData = {
            value: {
                name,
                trace: {
                    traceId: this.traceId,
                    spanId: this.spanId,
                    parentId: parentSpan?.parentId,
                },
            },
            next: {
                value: this._tracer.sharedEventData,
                next: this._propagatedEventData,
            },
        };
    }

    public static _start(
        tracer: TracerRoot,
        name: string,
        parentSpan: {
            traceId: TraceId;
            parentId: TraceSpanId;
            propagatedEventData?: LinkedList<TracerEventData>;
            propagatedEventFlatData?: TracerEventFlatData | null;
        } | null,
    ) {
        const span = new TracerSpan(tracer, name, parentSpan);
        const finishSpan = () => span._finish();
        return {span, finishSpan};
    }

    public getRoot(): TracerRoot {
        return this._tracer;
    }

    /**
     * See documentation for this method on `TracerBase.startSpan()`.
     */
    public startSpan(name: string) {
        return TracerSpan._start(this._tracer, name, {
            traceId: this.traceId,
            parentId: this.spanId,
            propagatedEventData: this._propagatedEventData,
            propagatedEventFlatData: this._propagatedEventFlatData,
        });
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
    public addException(error: unknown) {
        this.addData({
            exception: getExceptionTracerEventData(error),
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
     * When we make a network request from this span, we include propagation
     * context so that the server on the other end can attach its spans to the
     * trace.
     */
    public getPropagationContext(): TracerSpanPropagationContext {
        return {
            traceId: this.traceId,
            parentId: this.spanId,
            data: buildTracerEventFlatData(
                this._propagatedEventData,
                this._propagatedEventFlatData,
            ),
        };
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

        this._tracer._sendEvent(
            new TracerEvent(this._startTime, this._eventData, this._propagatedEventFlatData),
        );
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

        this._tracer._sendEvent(
            new TracerEvent(
                time,
                {
                    value: data,
                    next: {
                        value: this._tracer.sharedEventData,
                        next: this._propagatedEventData,
                    },
                },
                this._propagatedEventFlatData,
            ),
        );
    }

    /**
     * See documentation for this method on `TracerBase.log()`.
     */
    public log(name: string, data: TracerEventData = {}) {
        const time = this._tracer.getTime();

        this._tracer._sendEvent(
            new TracerEvent(
                time,
                {
                    value: data,
                    next: {
                        // Add this event to a span using the Honeycomb span event format:
                        // https://docs.honeycomb.io/getting-data-in/tracing/send-trace-data/#span-events
                        value: {
                            name,
                            meta: {annotationType: "span_event"},
                            trace: {
                                parentId: this.spanId,
                                traceId: this.traceId,
                            },
                        },
                        next: {
                            value: this._tracer.sharedEventData,
                            next: this._propagatedEventData,
                        },
                    },
                },
                this._propagatedEventFlatData,
            ),
        );
    }
}
