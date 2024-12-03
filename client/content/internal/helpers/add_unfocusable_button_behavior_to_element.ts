import {
    addParentScrollWhenPointerDownAndOverListener,
    removeParentScrollWhenPointerDownAndOverListener,
} from "~/client/content/internal/parent_scroll_when_pointer_down_and_over_event.js";
import {
    addTriggeredOverlayCloseEventListener,
    addTriggeredOverlayOpenEventListener,
    removeTriggeredOverlayCloseEventListener,
    removeTriggeredOverlayOpenEventListener,
} from "~/client/design/overlay_trigger_button_event_listeners.js";
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
 *
 * For example,
 *
 * @param element - The element to add unfocusable button behavior to.
 * @param options - Options for the unfocusable button behavior.
 * @returns A function to remove the unfocusable button behavior.
 */
export function addUnfocusableButtonBehaviorToElement(
    element: HTMLElement,
    {
        defaultClassName = "",
        hoverClassName = "",
        pressClassName = "",
        onHoverStart,
        onHoverEnd,
        onPress,
    }: {
        defaultClassName?: string;
        hoverClassName?: string;
        pressClassName?: string;
        onHoverStart?: () => void;
        onHoverEnd?: () => void;
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
        const newState = isPointerDownAndOver
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
    };

    const handlePointerUp = (event: PointerEvent) => {
        const wasPointerDownAndOver = isPointerDownAndOver;
        isPointerDownAndOver = false;
        maybeUpdateStyle();

        if (wasPointerDownAndOver) onPress?.(event);
    };

    const handlePointerEnter = () => {
        const wasPointerOver = isPointerOver;
        isPointerOver = true;
        maybeUpdateStyle();

        if (!wasPointerOver) onHoverStart?.();
    };

    const handlePointerLeave = () => {
        const wasPointerOver = isPointerOver;
        isPointerOver = false;
        isPointerDownAndOver = false;
        maybeUpdateStyle();

        if (wasPointerOver) onHoverEnd?.();
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
    addTriggeredOverlayOpenEventListener(element, handleTriggeredOverlayOpen);
    addTriggeredOverlayCloseEventListener(element, handleTriggeredOverlayClose);

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
        removeTriggeredOverlayOpenEventListener(element, handleTriggeredOverlayOpen);
        removeTriggeredOverlayCloseEventListener(element, handleTriggeredOverlayClose);
    };
}
