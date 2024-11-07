import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

let overlayTriggeredOpenEventEmitterByElement: WeakMap<Element, EventEmitter<void>> | undefined;
let overlayTriggeredCloseEventEmitterByElement: WeakMap<Element, EventEmitter<void>> | undefined;

export function dispatchTriggeredOverlayOpenEvent(element: Element) {
    overlayTriggeredOpenEventEmitterByElement?.get(element)?.emit();
}

export function dispatchTriggeredOverlayCloseEvent(element: Element) {
    overlayTriggeredCloseEventEmitterByElement?.get(element)?.emit();
}

export function addTriggeredOverlayOpenEventListener(element: Element, listener: () => void) {
    overlayTriggeredOpenEventEmitterByElement ??= new WeakMap();

    getOrSetDefaultMapValue(
        overlayTriggeredOpenEventEmitterByElement,
        element,
        () => new EventEmitter(),
    ).addListener(listener);
}

export function removeTriggeredOverlayOpenEventListener(element: Element, listener: () => void) {
    overlayTriggeredOpenEventEmitterByElement?.get(element)?.removeListener(listener);
}

export function addTriggeredOverlayCloseEventListener(element: Element, listener: () => void) {
    overlayTriggeredCloseEventEmitterByElement ??= new WeakMap();

    getOrSetDefaultMapValue(
        overlayTriggeredCloseEventEmitterByElement,
        element,
        () => new EventEmitter(),
    ).addListener(listener);
}

export function removeTriggeredOverlayCloseEventListener(element: Element, listener: () => void) {
    overlayTriggeredCloseEventEmitterByElement?.get(element)?.removeListener(listener);
}
