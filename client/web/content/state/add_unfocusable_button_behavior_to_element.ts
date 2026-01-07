import {
    addParentScrollWhenPointerDownAndOverListener,
    removeParentScrollWhenPointerDownAndOverListener,
} from "~/client/web/content/state/parent_scroll_when_pointer_down_and_over_event.js";
import {
    subscribeToTriggeredOverlayCloseEvent,
    subscribeToTriggeredOverlayOpenEvent,
} from "~/client/web/design/overlay_trigger_button_event_listeners.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

// EXAMPLE USAGE 1: In the code block in content editor
//
// When you are writing code and if you click on copy or language picker buttons,
// after the action is taken, you will be focused on the code block again at the
// same position you were before you clicked the button.

/**
 * Add unfocusable button behavior to an element.
 *
 * This is useful for creating a button-like element that doesn't take focus or
 * trigger hover styles when interacting with it.
 *
 * You can use this to add a button-like element to a code block that doesn't
 * take focus away from the code block when interacting with it.
 */
export function addUnfocusableButtonBehaviorToElement(
    element: HTMLElement,
    {
        isDisabled,
        defaultClassName = "",
        hoverClassName = "",
        pressClassName = "",
        onHoverStart,
        onHoverEnd,
        onPressStart,
        onPress,
    }: {
        isDisabled?: () => boolean;
        defaultClassName?: string;
        hoverClassName?: string;
        pressClassName?: string;
        onHoverStart?: () => void;
        onHoverEnd?: () => void;
        onPressStart?: (event: PointerEvent) => void;
        onPress?: (event: PointerEvent) => void;
    } = {},
): () => void {
    const defaultClassList = defaultClassName.length > 0 ? defaultClassName.split(" ") : [];
    const hoverClassList = hoverClassName.length > 0 ? hoverClassName.split(" ") : [];
    const pressClassList = pressClassName.length > 0 ? pressClassName.split(" ") : [];

    element.classList.add(...defaultClassList);

    let isPointerOver = false;
    let isPointerDownAndOver = false;
    let isTriggeredOverlayOpen = false;

    let state: "Pressed" | "Hovered" | null = null;

    const maybeUpdateStyle = () => {
        const oldState = state;
        const newState = isDisabled?.()
            ? null
            : isPointerDownAndOver
              ? "Pressed"
              : isPointerOver || isTriggeredOverlayOpen
                ? "Hovered"
                : null;

        state = newState;

        if (oldState === newState) return;

        switch (oldState) {
            case null:
                element.classList.remove(...defaultClassList);
                break;
            case "Pressed":
                element.classList.remove(...pressClassList);
                break;
            case "Hovered":
                element.classList.remove(...hoverClassList);
                break;
            default:
                throw exhaustive(oldState);
        }

        switch (newState) {
            case null:
                element.classList.add(...defaultClassList);
                break;
            case "Pressed":
                element.classList.add(...pressClassList);
                break;
            case "Hovered":
                element.classList.add(...hoverClassList);
                break;
            default:
                throw exhaustive(newState);
        }
    };

    const handlePointerDown = (event: PointerEvent) => {
        isPointerDownAndOver = event.button === 0;
        maybeUpdateStyle();

        if (!isPointerDownAndOver) return;

        // Prevent focus from moving or text from being selected.
        event.preventDefault();

        onPressStart?.(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
        const wasPointerDownAndOver = isPointerDownAndOver;
        isPointerDownAndOver = false;
        maybeUpdateStyle();

        if (wasPointerDownAndOver && !isDisabled?.()) onPress?.(event);
    };

    const handlePointerEnter = () => {
        const wasPointerOver = isPointerOver;
        isPointerOver = true;
        maybeUpdateStyle();

        if (!wasPointerOver && !isDisabled?.()) onHoverStart?.();
    };

    const handlePointerLeave = () => {
        const wasPointerOver = isPointerOver;
        isPointerOver = false;
        isPointerDownAndOver = false;
        maybeUpdateStyle();

        if (wasPointerOver && !isDisabled?.()) onHoverEnd?.();
    };

    const handlePointerCancel = () => {
        isPointerDownAndOver = false;
        maybeUpdateStyle();
    };

    const handleDragStart = () => {
        isPointerDownAndOver = false;
        maybeUpdateStyle();
    };

    const handleParentScrollWhenPointerDownAndOver = () => {
        isPointerDownAndOver = false;
        maybeUpdateStyle();
    };

    const handleTriggeredOverlayOpen = () => {
        isTriggeredOverlayOpen = true;
        maybeUpdateStyle();
    };

    const handleTriggeredOverlayClose = () => {
        isTriggeredOverlayOpen = false;
        maybeUpdateStyle();
    };

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointerup", handlePointerUp);
    element.addEventListener("pointerenter", handlePointerEnter);
    element.addEventListener("pointerleave", handlePointerLeave);
    element.addEventListener("pointercancel", handlePointerCancel);
    element.addEventListener("dragstart", handleDragStart);
    addParentScrollWhenPointerDownAndOverListener(
        element,
        handleParentScrollWhenPointerDownAndOver,
    );
    const unsubscribe1 = subscribeToTriggeredOverlayOpenEvent(element, handleTriggeredOverlayOpen);
    const unsubscribe2 = subscribeToTriggeredOverlayCloseEvent(
        element,
        handleTriggeredOverlayClose,
    );

    return () => {
        element.classList.remove(...defaultClassList, ...hoverClassList, ...pressClassList);

        element.removeEventListener("pointerdown", handlePointerDown);
        element.removeEventListener("pointerup", handlePointerUp);
        element.removeEventListener("pointerenter", handlePointerEnter);
        element.removeEventListener("pointerleave", handlePointerLeave);
        element.removeEventListener("pointercancel", handlePointerCancel);
        element.removeEventListener("dragstart", handleDragStart);
        removeParentScrollWhenPointerDownAndOverListener(
            element,
            handleParentScrollWhenPointerDownAndOver,
        );
        unsubscribe1();
        unsubscribe2();
    };
}
