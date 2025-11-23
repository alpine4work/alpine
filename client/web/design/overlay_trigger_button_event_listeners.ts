import {ElementEventEmitter} from "~/client/web/helpers/element_event_emitter.js";

const overlayTriggeredOpenEventEmitter = new ElementEventEmitter("overlayopen");
const overlayTriggeredCloseEventEmitter = new ElementEventEmitter("overlayclose");

export function dispatchTriggeredOverlayOpenEvent(element: Element) {
    overlayTriggeredOpenEventEmitter.emit(element);
}

export function dispatchTriggeredOverlayCloseEvent(element: Element) {
    overlayTriggeredCloseEventEmitter.emit(element);
}

export function subscribeToTriggeredOverlayOpenEvent(element: Element, listener: () => void) {
    return overlayTriggeredOpenEventEmitter.subscribe(element, listener);
}

export function subscribeToTriggeredOverlayCloseEvent(element: Element, listener: () => void) {
    return overlayTriggeredCloseEventEmitter.subscribe(element, listener);
}
