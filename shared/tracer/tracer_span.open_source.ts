import {InternalError} from "~/shared/error/error.open_source.js";
import {getOrSetErrorOriginalTracerSpan} from "~/shared/error/error_original_tracer_span.open_source.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {
    LinkedList,
    NonEmptyLinkedList,
} from "~/shared/helpers/immutable/linked_list.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.open_source.js";
import {
    TracerEventFlatData,
    buildTracerEventFlatData,
} from "~/shared/tracer/helpers/build_tracer_event_flat_data.open_source.js";
import {getTracerEventExceptionData} from "~/shared/tracer/helpers/get_tracer_event_exception_data.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerEventData, TracerEventFullData} from "~/shared/tracer/types/tracer_event_data.js";

export type TracerSpanPropagationContext = {
    readonly traceId: TraceId;
    readonly parentId: TraceSpanId;
    readonly data: TracerEventFlatData;
};

/**
 * A distributed tracing span.
 *
 * Very close to [OpenTelemetry][1] spans but simpler and with a few
 * customizations.
 *
 * [1]: https://opentelemetry.io
 */
export class TracerSpan extends TracerBase {
    /**
     * The root tracer for this span.
     */
    private readonly _tracer: TracerRoot;

    /**
     * The monotonic clock we use for measuring span times.
     */
    public readonly clock: MonotonicClock;

    /**
     * The name of the trace.
     */
    private _name: string;

    /**
     * The ID of the trace this span is in.
     */
    public readonly traceId: TraceId;

    /**
     * This span's ID.
     */
    private readonly _spanId: TraceSpanId;

    /**
     * The time at which the span started.
     */
    private readonly _startTime: number;

    /**
     * Has the span finished? Once the span is finished it will be sent so you can't
     * add more data.
     */
    private _isFinished = false;

    /**
     * We collect span data in a linked list that we merge into a single document only
     * when we send to our telemetry service. That way we don't need to do an object
     * clone for every span. Arguably a premature optimization.
     */
    private _eventData: NonEmptyLinkedList<TracerEventFullData>;

    /**
     * Data that is propagated to all child spans and across process boundaries.
     */
    private _propagatedEventData: LinkedList<TracerEventData>;

    /**
     * Flat data that was propagated to our span over the network. It may come from a
     * different programming language runtime so the data is in our network event
     * format instead of our nested object format.
     */
    private _propagatedEventFlatData: TracerEventFlatData | null;

    /**
     * Was an exception added to this span? If an exception was added to the span then
     * additional exceptions added with `addException()` are logged.
     */
    private _hasException = false;

    /**
     * Was this span referenced by some other span? For example a child span, a log, or
     * a link. If we generated a propagation context for this span we also treat it as
     * referenced since we can't know for sure whether the propagation context is used
     * by a different process.
     *
     * Used to only send spans if they're referenced by some other send.
     */
    private _isReferenced = false;

    /**
     * If true, we won't send the event to our observability provider if the span
     * wasn't referenced. Useful for recurring events that are usually noops.
     */
    private _willNotSendIfNotReferenced = false;

    /**
     * Allow the parent span to keep track of the child spans it starts within the
     * local process. We can't track child spans across network boundaries.
     */
    private _localChildSpanTrackers: Array<Array<TracerSpan>> | null = null;

    private constructor(
        tracer: TracerRoot,
        clock: MonotonicClock,
        name: string,
        parentSpan: {
            traceId?: TraceId;
            parentId?: TraceSpanId;
            propagatedEventData?: LinkedList<TracerEventData>;
            propagatedEventFlatData?: TracerEventFlatData | null;
        } | null,
        spanId: TraceSpanId = generateId(),
        startTime: number = clock.now(),
    ) {
        if (
            parentSpan !== null &&
            parentSpan.parentId !== undefined &&
            parentSpan.traceId === undefined
        ) {
            throw new InternalError("If `parentId` is set then `traceId` must also be set");
        }

        super();

        this._tracer = tracer;
        this.clock = clock;
        this._name = name;
        this.traceId = parentSpan?.traceId ?? generateId();
        this._spanId = spanId;
        this._startTime = startTime;
        this._propagatedEventData = parentSpan
            ? (parentSpan.propagatedEventData ?? null)
            : this._tracer.propagatedEventData
              ? {value: this._tracer.propagatedEventData, next: null}
              : null;
        this._propagatedEventFlatData = parentSpan?.propagatedEventFlatData ?? null;

        this._eventData = {
            value: {
                trace: {
                    traceId: this.traceId,
                    spanId: this._spanId,
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
        clock: MonotonicClock,
        name: string,
        parentSpan: {
            traceId?: TraceId;
            parentId?: TraceSpanId;
            propagatedEventData?: LinkedList<TracerEventData>;
            propagatedEventFlatData?: TracerEventFlatData | null;
        } | null,
        spanId?: TraceSpanId,
        startTime?: number,
    ) {
        const span = new TracerSpan(tracer, clock, name, parentSpan, spanId, startTime);
        const finishSpan = () => span._finish();
        return {span, finishSpan};
    }

    public static _startWithEndTime(
        tracer: TracerRoot,
        clock: MonotonicClock,
        name: string,
        parentSpan: {
            traceId?: TraceId;
            parentId?: TraceSpanId;
            propagatedEventData?: LinkedList<TracerEventData>;
            propagatedEventFlatData?: TracerEventFlatData | null;
        } | null,
        spanId?: TraceSpanId,
        startTime?: number,
    ) {
        const span = new TracerSpan(tracer, clock, name, parentSpan, spanId, startTime);
        const finishSpan = (endTime: number) => span._finish(endTime);
        return {span, finishSpan};
    }

    /**
     * Provide access to this property so you can build custom spans with `_start()`.
     * You must know what you're doing to directly call this function! Prefer the
     * methods which don't start with an underscore.
     *
     * In the future consider auditing use cases of this function and providing proper
     * public APIs.
     */
    public _getSpanId() {
        return this._spanId;
    }

    /**
     * Provide access to this property so you can build custom spans with `_start()`.
     * You must know what you're doing to directly call this function! Prefer the
     * methods which don't start with an underscore.
     *
     * In the future consider auditing use cases of this function and providing proper
     * public APIs.
     */
    public _getPropagatedEventData() {
        return this._propagatedEventData;
    }

    /**
     * Provide access to this property so you can build custom spans with `_start()`.
     * You must know what you're doing to directly call this function! Prefer the
     * methods which don't start with an underscore.
     *
     * In the future consider auditing use cases of this function and providing proper
     * public APIs.
     */
    public _getPropagatedEventFlatData() {
        return this._propagatedEventFlatData;
    }

    public getRoot(): TracerRoot {
        return this._tracer;
    }

    /**
     * See documentation for this method on `TracerBase.startSpan()`.
     */
    public startSpan(name: string) {
        this._isReferenced = true;

        const childSpan = TracerSpan._start(
            this._tracer,
            // Inherit the parent span's clock (not the tracer clock) for consistent times.
            this.clock,
            name,
            {
                traceId: this.traceId,
                parentId: this._spanId,
                propagatedEventData: this._propagatedEventData,
                propagatedEventFlatData: this._propagatedEventFlatData,
            },
        );

        // If we're keeping track of child spans with `trackLocalChildSpans()` then add
        // this new child span to the list.
        if (this._localChildSpanTrackers !== null)
            for (const localChildSpans of this._localChildSpanTrackers)
                localChildSpans.push(childSpan.span);

        return childSpan;
    }

    /**
     * See documentation for this method on `TracerBase.startSpanAsLinked()`.
     */
    public startSpanAsLinked(name: string) {
        this._isReferenced = true;

        const {span, finishSpan} = TracerSpan._start(
            this._tracer,
            // Inherit the parent span's clock (not the tracer clock) for consistent times.
            this.clock,
            name,
            {
                propagatedEventData: this._propagatedEventData,
                propagatedEventFlatData: this._propagatedEventFlatData,
            },
        );

        span.link(`Parent of: ${name}`, {
            traceId: this.traceId,
            spanId: this._spanId,
        });

        return {span, finishSpan};
    }

    /**
     * Has the span finished?
     */
    public isFinished() {
        return this._isFinished;
    }

    /**
     * Get the span's name.
     */
    public getName(): string {
        return this._name;
    }

    /**
     * Append some text to the end of this span's name.
     *
     * We want the creator of the span to control the span's name but allow later code
     * to add extra information to the name.
     */
    public appendName(name: string) {
        assert(!this._isFinished);
        this._name += name;
    }

    /**
     * Completely change this span's name.
     *
     * Ideally, we want the creator of the span to control the span's name. However,
     * there are some cases where it's reasonable to let the consumer of a span change
     * the name. This method is "reckless" because you are throwing away the creator's
     * span name.
     *
     * Prefer using `appendName()` which keeps the name the span creator intended while
     * allowing span consumers to modify it.
     */
    public recklesslyOverrideName(name: string) {
        assert(!this._isFinished);
        this._name = name;
    }

    /**
     * Add some data to this span.
     *
     * Nested objects are recursively merged in.
     */
    public addData(data: TracerEventData) {
        assert(!this._isFinished);

        this._eventData = {
            value: data,
            next: this._eventData,
        };
    }

    /**
     * Add an exception to the span's data. Puts the span in an error state. If the
     * span already has an exception then we log an additional exception.
     */
    public addException(error: unknown) {
        if (this._hasException) {
            this.logException("Additional exception", error);
            return;
        }

        this._hasException = true;

        this.addData({
            exception: getTracerEventExceptionData(
                this.traceId,
                error,
                getOrSetErrorOriginalTracerSpan(error, () => ({
                    time: new Date(this._startTime),
                    traceId: this.traceId,
                    spanId: this._spanId,
                })),
            ),
        });
    }

    /**
     * Add some data to this span and all child spans created after this function call.
     * We also send this data over the network so that spans in distributed services
     * also add our propagated data.
     *
     * We will not added this propagated data to spans created before this function
     * call.
     */
    public addPropagatedData(data: TracerEventData) {
        assert(!this._isFinished);

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
     * Add some data to all child spans created after this function call. We also send
     * this data over the network so that spans in distributed services also add our
     * propagated data.
     *
     * We will not added this propagated data to spans created before this function
     * call.
     *
     * Unlike `addPropagatedData()`, we do not add the propagated data to this span as
     * well.
     */
    public addPropagatedDataForChildrenOnly(data: TracerEventData) {
        assert(!this._isFinished);

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
     * When we make a network request from this span, we include propagation context so
     * that the server on the other end can attach its spans to the trace.
     */
    public getPropagationContext(): TracerSpanPropagationContext {
        this._isReferenced = true;

        return {
            traceId: this.traceId,
            parentId: this._spanId,
            data: buildTracerEventFlatData(
                this._propagatedEventData,
                this._propagatedEventFlatData,
            ),
        };
    }

    /**
     * Adds propagated flat data underneath all other data in the span. So any existing
     * propagated data will override this flat data. Which is why this is "default"
     * flat data.
     *
     * Public but with an underscore since this shouldn't be a commonly used method.
     * It's only useful in niche situations like when you want to start a span with two
     * propagated span sources.
     *
     * Maybe a better method would take `TracerSpanPropagationContext` and create a
     * `link()` + update propagation context?
     */
    public _addDefaultPropagatedFlatData(data: TracerEventFlatData) {
        this._propagatedEventFlatData = {
            ...data,
            ...this._propagatedEventFlatData,
        };
    }

    /**
     * If set to true, we won't send the event to our observability provider if the
     * span wasn't referenced. Useful for recurring events that are usually noops.
     */
    public setWillNotSendIfNotReferenced(willNotSendIfNotReferenced: boolean) {
        assert(!this._isFinished);
        this._willNotSendIfNotReferenced = willNotSendIfNotReferenced;
    }

    /**
     * Returns an array with all child spans have started locally within this process
     * after you call this function. Won't know spans created before this call.
     */
    public trackLocalChildSpans(): Array<TracerSpan> {
        if (this._localChildSpanTrackers === null) this._localChildSpanTrackers = [];
        const localChildSpans: Array<TracerSpan> = [];
        this._localChildSpanTrackers.push(localChildSpans);
        return localChildSpans;
    }

    /**
     * Finishes the span. Finished spans will be sent to our observability service.
     */
    private _finish(endTime = this.clock.now()) {
        assert(!this._isFinished);
        this._isFinished = true;

        const durationMs = endTime - this._startTime;

        this._eventData = {
            value: {name: this._name, durationMs},
            next: this._eventData,
        };

        if (this._willNotSendIfNotReferenced && !this._isReferenced) {
            return;
        }

        this._tracer._sendEvent(
            new TracerEvent(this._startTime, this._eventData, this._propagatedEventFlatData),
        );
    }

    /**
     * Usually it's enough to express span relationships as parent/child relationships.
     * However, sometimes you have causal relationships between spans that don't have a
     * clean parent/child relationship. For example batch processing from many spans.
     * You may use the link function to express a causal relationship between these
     * spans.
     */
    public link(name: string, span: {traceId: TraceId; spanId: TraceSpanId} | TracerSpan) {
        this._isReferenced = true;
        if (span instanceof TracerSpan) span._isReferenced = true;

        const time = this.clock.now();

        // Link this span with another using the Honeycomb link event format:
        // https://docs.honeycomb.io/getting-data-in/tracing/send-trace-data/#links
        const data: TracerEventFullData = {
            name,
            meta: {annotationType: "link"},
            trace: {
                parentId: this._spanId,
                traceId: this.traceId,
                link: {
                    traceId: span.traceId,
                    spanId: span instanceof TracerSpan ? span._spanId : span.spanId,
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
        this._isReferenced = true;

        const time = this.clock.now();

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
                                parentId: this._spanId,
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

    /**
     * Log an exception in the span. Useful if you've already called `addException()`
     * and need to report another exception with the span.
     */
    public logException(name: string, error: unknown) {
        this.log(name, {
            exception: getTracerEventExceptionData(
                this.traceId,
                error,
                getOrSetErrorOriginalTracerSpan(error, () => ({
                    time: new Date(this._startTime),
                    traceId: this.traceId,
                    spanId: this._spanId,
                })),
            ),
        });
    }
}
