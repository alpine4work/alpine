import {handleContentLinkClick} from "~/client/web/content/internal/handle_content_link_click.js";
import {
    addParentScrollWhenPointerDownAndOverListener,
    removeParentScrollWhenPointerDownAndOverListener,
} from "~/client/web/content/state/parent_scroll_when_pointer_down_and_over_event.js";
import {isModifiedPointerEvent} from "~/client/web/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/web/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {NavigateFunction} from "~/client/web/remix/use_navigate.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {linkClassName} from "~/shared/design/core/constant_class_names.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export function addContentViewLinkBehavior(element: HTMLAnchorElement, navigate: NavigateFunction) {
    const isLink = element.classList.contains(linkClassName);
    const isMention = element.classList.contains(contentStyles.mentionContainerClassName);

    let isPointerDownAndOver = false;

    const maybeUpdateStyle = () => {
        if (isLink) {
            if (isPointerDownAndOver) {
                element.classList.add(contentStyles.linkPressedClassName);
            } else {
                element.classList.remove(contentStyles.linkPressedClassName);
            }
        }

        if (isMention) {
            if (isPointerDownAndOver) {
                element.classList.add(contentStyles.mentionPressedClassName);
            } else {
                element.classList.remove(contentStyles.mentionPressedClassName);
            }
        }
    };

    const handleClick = (event: MouseEvent) => {
        const isOpenLinkInSeparateTabEvent = isOpenLinkInSeparateTabPointerEvent(
            event,
            getClientInfo(),
        );

        // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
        // modifier. Unless the click was meant to open the link in a separate tab. We need
        // to implement that manually here given the text is editable.
        if (
            (event.button !== 0 || isModifiedPointerEvent(event)) &&
            !isOpenLinkInSeparateTabEvent
        ) {
            return;
        }

        // Must call prevent default here in addition to `pointerdown` to stop mobile
        // WebKit from following a link after click.
        event.preventDefault();
    };

    const handlePointerDown = (event: MouseEvent) => {
        isPointerDownAndOver =
            event.button === 0 &&
            (!isModifiedPointerEvent(event) ||
                isOpenLinkInSeparateTabPointerEvent(event, getClientInfo()));

        maybeUpdateStyle();

        // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
        // modifier. Unless the click was meant to open the link in a separate tab. We need
        // to implement that manually here given the text is editable.
        if (
            (event.button !== 0 || isModifiedPointerEvent(event)) &&
            !isOpenLinkInSeparateTabPointerEvent(event, getClientInfo())
        ) {
            return;
        }

        // This will be a navigation click if the pointer stays over our element. Don't
        // select the editable text.
        event.preventDefault();
    };

    const handlePointerUp = (event: MouseEvent) => {
        const wasPointerDownAndOver = isPointerDownAndOver;
        isPointerDownAndOver = false;
        maybeUpdateStyle();

        // Only process pointer up events that started on our element.
        if (!wasPointerDownAndOver) {
            return;
        }

        assert(event.currentTarget instanceof HTMLAnchorElement);

        handleContentLinkClick(event, event.currentTarget.href, navigate);
    };

    const handlePointerLeave = () => {
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

    element.addEventListener("click", handleClick);
    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointerup", handlePointerUp);
    element.addEventListener("pointerleave", handlePointerLeave);
    element.addEventListener("dragstart", handleDragStart);
    addParentScrollWhenPointerDownAndOverListener(
        element,
        handleParentScrollWhenPointerDownAndOver,
    );

    return () => {
        element.removeEventListener("click", handleClick);
        element.removeEventListener("pointerdown", handlePointerDown);
        element.removeEventListener("pointerup", handlePointerUp);
        element.removeEventListener("pointerleave", handlePointerLeave);
        element.removeEventListener("dragstart", handleDragStart);
        removeParentScrollWhenPointerDownAndOverListener(
            element,
            handleParentScrollWhenPointerDownAndOver,
        );
    };
}
