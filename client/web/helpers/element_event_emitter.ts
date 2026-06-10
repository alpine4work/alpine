import {assert} from "~/shared/helpers/control/assert.js";

let elementEventEmitterNames: Set<string> | undefined;

/**
 * Allow producers to emit events on DOM elements to any consumer. Has a similar
 * API to `EventEmitter` but under the hood we're using the [DOM's
 * `dispatchEvent()` method][1]. In theory, if you're dealing with HTML elements
 * then this is more efficient than `EventEmitter`.
 *
 * The convention is to use an all lowercase string with no spaces for the event
 * name. To match DOM event names.
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/Events/Creating_and_triggering_events
 */
export class ElementEventEmitter<Event = void> {
    private readonly _name: string;

    constructor(name: string) {
        assert(/^[a-z0-9]+$/.test(name));

        this._name = `cyberworlds-${name}`;

        // Make sure `name` strings provided to this class are unique. Disabled in
        // development since this breaks when hot reloading.
        if (process.env.NODE_ENV !== "development") {
            assert(!elementEventEmitterNames?.has(this._name));
            (elementEventEmitterNames ??= new Set()).add(this._name);
        }
    }

    /**
     * Emit an event to all subscribers of the event emitter.
     */
    public emit(element: Element, event: Event): void {
        const actualEvent = new CustomEvent(this._name, {
            bubbles: false,
            detail: event,
        });

        element.dispatchEvent(actualEvent);
    }

    /**
     * Subscribe to all events emit on this event emitter. Returns a function to
     * unsubscribe from events.
     */
    public subscribe(element: Element, listener: (event: Event) => void): () => void {
        const actualListener = (actualEvent: globalThis.Event) => {
            const event = (actualEvent as CustomEvent).detail;
            listener(event);
        };

        element.addEventListener(this._name, actualListener);

        return () => {
            element.removeEventListener(this._name, actualListener);
        };
    }
}
