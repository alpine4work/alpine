import {assert} from "~/shared/helpers/control/assert";

export type Unsubscribe = () => void;

export class EventEmitter<Event extends Array<unknown> = []> {
    private listeners: Set<{callback: (...args: Event) => void}> = new Set();

    subscribe(callback: (...args: Event) => void): Unsubscribe {
        const listener = {callback};
        this.listeners.add(listener);
        return () => {
            assert(this.listeners.has(listener), "listener was already unsubscribed");
            this.listeners.delete(listener);
        };
    }

    emit(...args: Event): void {
        for (const listener of this.listeners) {
            listener.callback(...args);
        }
    }
}
