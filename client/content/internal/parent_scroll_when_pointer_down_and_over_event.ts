import {contentStyles} from "~/client/styles/styles.js";
import {commentClassName, linkClassName} from "~/shared/content/content_styles.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

let parentScrollWhenPointerDownAndOverEventEmitterByElement:
    | WeakMap<Element, EventEmitter<void>>
    | undefined;

/**
 * Dispatch an event to any listeners attached to this element with
 * `addParentScrollWhenPointerDownAndOverListener()`. This event is dispatched
 * if the user's pointer is down and then a scroll occurs. This happens on
 * mobile when the user touches down then drags. We want to cancel any touch
 * behavior at this point and instead let the user scroll.
 *
 * For the element to receive these events it must have the class name
 * `parentScrollWhenPointerDownAndOverReceiverClassName`. `linkClassName` and
 * `commentClassName` are implicitly receivers of this event.
 */
export function dispatchParentScrollWhenPointerDownAndOverEvent(element: Element) {
    parentScrollWhenPointerDownAndOverEventEmitterByElement?.get(element)?.emit();
}

export function addParentScrollWhenPointerDownAndOverListener(
    element: Element,
    listener: () => void,
) {
    assert(
        element.classList.contains(
            contentStyles.parentScrollWhenPointerDownAndOverReceiverClassName,
        ) ||
            element.classList.contains(linkClassName) ||
            element.classList.contains(commentClassName),
    );

    parentScrollWhenPointerDownAndOverEventEmitterByElement ??= new WeakMap();

    getOrSetDefaultMapValue(
        parentScrollWhenPointerDownAndOverEventEmitterByElement,
        element,
        () => new EventEmitter(),
    ).addListener(listener);
}

export function removeParentScrollWhenPointerDownAndOverListener(
    element: Element,
    listener: () => void,
) {
    parentScrollWhenPointerDownAndOverEventEmitterByElement?.get(element)?.removeListener(listener);
}
