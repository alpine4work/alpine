import {Queue} from "~/shared/helpers/array/queue.open_source.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";

/**
 * A combination of `EventEmitter` and `Queue` that lets a consumer to listen to
 * events from a producer.
 *
 * Designed for multi-producer single-consumer use cases. If there are multiple
 * consumers then the first consumer to call `dequeue()` gets the event and no
 * other consumer gets the event.
 *
 * Designed to be used as an async iterable. For example:
 *
 * ```
 * for await (const event of eventQueue) {
 *     // ...
 * }
 * ```
 */
export class EventQueue<Event = void> {
    private readonly _emitter = new EventEmitter();
    private readonly _queue = new Queue<Event>();

    /**
     * Adds an event to the queue and notifies any listeners that there's a new event
     * available in the queue.
     */
    public enqueue(event: Event): void {
        this._queue.enqueue(event);
        this._emitter.emit();
    }

    /**
     * Returns the first event in the queue without removing it.
     */
    public peek(): Event | undefined {
        return this._queue.peek();
    }

    /**
     * Removes the first event from the queue and returns it.
     */
    public dequeue(): Event | undefined {
        return this._queue.dequeue();
    }

    /**
     * Subscribe to events as they are added to the queue. If there are any existing
     * events in the queue then they are dequeued first before we subscribe to new
     * events.
     *
     * This class is intended to be used as an async iterable. Allowing you to observe
     * events that enter the queue.
     *
     * Unlike `addListener()` and `subscribe()` which do not consume events (you must
     * call `dequeue()` yourself).
     */
    public async *[Symbol.asyncIterator](): AsyncIterableIterator<Event> {
        while (true) {
            const event = this._queue.dequeue();
            if (event === undefined) break;
            yield event;
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of this._emitter) {
            while (true) {
                const event = this._queue.dequeue();
                if (event === undefined) break;
                yield event;
            }
        }
    }

    /**
     * Listen for new events to be added to the queue. When a new event is added you
     * must call `dequeue()` to remove it from the queue. Only the first consumer will
     * be able to `dequeue()` an event. All other consumers will get nothing.
     */
    public addListener(listener: () => void) {
        this._emitter.addListener(listener);
    }

    /**
     * Stop listening for events to be added to the queue.
     */
    public removeListener(listener: () => void) {
        this._emitter.removeListener(listener);
    }

    /**
     * Subscribe to new events added to the queue. When a new event is added you must
     * call `dequeue()` to remove it from the queue. Only the first consumer will be
     * able to `dequeue()` an event. All other consumers will get nothing.
     *
     * Returns a function that will unsubscribe the listener from the queue.
     */
    public subscribe(listener: () => void): () => void {
        return this._emitter.subscribe(listener);
    }
}
