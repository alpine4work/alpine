import {LinkedList} from "~/shared/helpers/immutable/linked_list.open_source.js";
import {
    TracerEventFlatData,
    buildTracerEventFlatData,
} from "~/shared/tracer/helpers/build_tracer_event_flat_data.open_source.js";
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * An in-memory tracer event. Events are structured so they can be cheaply
 * constructed and modified to avoid slowing down performance critical code. Then
 * when we send tracer events to the server we convert them into their final
 * format.
 *
 * Event data is represented as a linked list. Every time we call `span.addData()`
 * it adds to the linked list instead of doing an O(data) merge. Then we merge data
 * before sending it to the server.
 */
export class TracerEvent {
    public readonly time: number;
    private readonly _eventData: LinkedList<TracerEventFullData>;
    private readonly _propagatedEventFlatData: TracerEventFlatData | null;
    private _flatEventData: TracerEventFlatData | null = null;

    constructor(
        time: number,
        eventData: LinkedList<TracerEventFullData>,
        propagatedEventFlatData: TracerEventFlatData | null,
    ) {
        this.time = time;
        this._eventData = eventData;
        this._propagatedEventFlatData = propagatedEventFlatData;
    }

    /**
     * Gets the flattened data for this tracer event which we can send over the wire.
     * We lazily flatten data the first time this function is called.
     */
    public getFlatData(): TracerEventFlatData {
        if (this._flatEventData === null) {
            this._flatEventData =
                this._eventData !== null
                    ? buildTracerEventFlatData(this._eventData, this._propagatedEventFlatData)
                    : (this._propagatedEventFlatData ?? {});
        }
        return this._flatEventData;
    }
}

export function convertTracerEventFlatDataToKinesisData({
    time,
    data,
}: {
    time: number;
    data: TracerEventFlatData;
}): Record<string, unknown> {
    const kinesisData: Record<string, unknown> = {};

    kinesisData["time"] = new Date(time).toISOString();

    const durationMs = kinesisData["duration_ms"];
    if (typeof durationMs === "number") {
        kinesisData["end_time"] = new Date(time + durationMs).toISOString();
    }

    for (const [key, value] of Object.entries(data)) {
        kinesisData[key.replaceAll(".", "__")] = value;
    }

    return kinesisData;
}
