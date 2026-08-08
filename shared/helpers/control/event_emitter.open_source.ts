import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.open_source.js";

/**
 * Allow producers to emit events to many consumers.
 *
 * Inspired by the Node.js [`EventEmitter`][1] API which is common among Node.js
 * programs.
 *
 * [1]: https://nodejs.org/api/events.html#class-eventemitter
 */
export class EventEmitter<Event = void> {
    private _listeners = new Set<(event: Event) => void>();

    /**
     * Emit an event to all subscribers of the event emitter.
     */
    public emit(event: Event): void {
        for (const listener of this._listeners) {
            try {
                listener(event);
            } catch (error) {
                // If one of our listeners throws an error, continue calling the rest of our
                // listeners.
                //
                // Treat listener errors as unhandled errors. Emitting an event should not need to
                // think about downstream listener implementation details.
                scheduleUncaughtError(error);
            }
        }
    }

    /**
     * Subscribe a listener to events emit by this event emitter.
     *
     * Same style API as the DOM's `EventTarget.removeEventListener()`.
     */
    public addListener(listener: (event: Event) => void) {
        this._listeners.add(listener);
    }

    /**
     * Unsubscribe from events emit by this event emitter.
     *
     * Same style API as the DOM's `EventTarget.addEventListener()`.
     */
    public removeListener(listener: (event: Event) => void) {
        this._listeners.delete(listener);
    }

    /**
     * Subscribe to all events emit on this event emitter. Returns a function to
     * unsubscribe from events.
     *
     * Useful for React's `useEffect()` hook which also expects the unsubscribe
     * function to be returned.
     */
    public subscribe(listener: (event: Event) => void): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * Allow treating the `EventEmitter` as an `AsyncIterable`. Useful for integrating
     * `EventEmitter` with native platform features.
     */
    public async *[Symbol.asyncIterator](): AsyncIterableIterator<Event> {
        let promiseResolver = createPromiseResolver<Event>();

        const listener = (event: Event) => {
            const lastPromiseResolver = promiseResolver;
            promiseResolver = createPromiseResolver();
            lastPromiseResolver.resolve(event);
        };

        this._listeners.add(listener);

        try {
            // TODO(calebmer): Doesn't this implementation need an event queue in case the
            // consumer doesn't immediately call `next()` after a value is yielded? I think
            // this is broken.
            while (true) {
                const event = await promiseResolver.promise;
                yield event;
            }
        } finally {
            this._listeners.delete(listener);
        }
    }
}
