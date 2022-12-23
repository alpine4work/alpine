import {ErrorBase} from "~/shared/error/error";
import {ErrorCode, getErrorCodeName} from "~/shared/error/error_code";
import {assert} from "~/shared/helpers/control/assert";
import {LinkedList, NonEmptyLinkedList} from "~/shared/helpers/immutable/linked_list";
import {Id, generateId} from "~/shared/id/id";
import {Tracer} from "~/shared/tracer/tracer";
import {TracerEventData, TracerEventFullData} from "~/shared/tracer/types/tracer_event_data";

/**
 * A distributed tracing span.
 *
 * Very close to [OpenTelemetry][1] spans but simpler and with a
 * few customizations.
 *
 * [1]: https://opentelemetry.io
 */
export class TracerSpan {
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
     * Data that is propagated to all child spans and across network requests.
     */
    private _propagatedEventData: LinkedList<TracerEventData>;

    // Private: Only `Tracer` and `TracerSpan` should be able to create new spans.
    private constructor(
        private readonly _tracer: Tracer,
        public readonly name: string,
        parentSpan: TracerSpan | null = null,
    ) {
        assert(!parentSpan || this._tracer === parentSpan._tracer);

        this.traceId = parentSpan?.traceId ?? generateId();
        this.spanId = generateId();
        this._startTime = this._tracer.getTime();
        this._propagatedEventData = parentSpan?._propagatedEventData ?? null;

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
     * Finishes the span. Finished spans will be sent to our observability service.
     */
    public finish() {
        assert(!this._finished);

        const endTime = this._tracer.getTime();

        this._eventData = {
            value: {durationMs: endTime - this._startTime},
            next: this._eventData,
        };
    }

    /**
     * Start a new span as a child of this one. Part of the same trace.
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
    public startChildSpan(name: string): TracerSpan {
        return new TracerSpan(this._tracer, name, this);
    }
}
