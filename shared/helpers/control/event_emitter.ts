import {scheduleException} from "~/shared/helpers/async/schedule_exception";

/**
 * Allow producers to emit events to many consumers.
 *
 * Inspired by the Node.js [`EventEmitter`][1] API which is common among Node.js
 * programs.
 *
 * [1]: https://nodejs.org/api/events.html#class-eventemitter
 */
export class EventEmitter<Event = void> {
    private listeners: Set<(event: Event) => void> = new Set();

    /**
     * Emit an event to all subscribers of the event emitter.
     */
    emit(event: Event): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                // If one of our listeners throws an error, continue calling the rest of our
                // listeners.
                //
                // Treat listener errors as unhandled errors. Emitting an event should not need
                // to think about downstream listener implementation details.
                scheduleException(error);
            }
        }
    }

    /**
     * Subscribe to all events emit on this event emitter.
     */
    subscribe(listener: (event: Event) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}
