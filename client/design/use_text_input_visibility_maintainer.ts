import {useEffect} from "react";
import {
    flushNavigationBarScrollEventEmitter,
    navigationBarHeightRem,
} from "~/client/design/navigation_bar_helpers.js";
import {getElementSafeAreaInsetTopPx} from "~/client/design/safe_area_inset.js";
import {useIsBehindMobileFullScreenModal} from "~/client/design/use_is_behind_mobile_full_screen_modal.js";
import {useGetCurrentCoveredHeight} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {getRemPxWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

export const textInputVisibilityMaintainerMarginYRem = parseRemLength("5");

const maintainTextInputVisibilityEmitter = new EventEmitter<HTMLElement>();

/**
 * Normally `registerTextInputVisibilityMaintainer()` will make sure text
 * inputs remain visible by listening to the `input` event. However, if you
 * make a change that doesn't trigger an `input` event and you need to make
 * sure the text input remains visible you may manually call this function.
 *
 * One case where this is used is when a task grid view hits enter to create a
 * new task. We want to make sure the new task is visible but no `input` event
 * is dispatched.
 */
export function maintainTextInputVisibility(targetElement: HTMLElement) {
    maintainTextInputVisibilityEmitter.emit(targetElement);
}

/**
 * When the user types in a text input that's offscreen we want to scroll the
 * text input onscreen so the user can see what they're typing. The browser has
 * some logic to automatically adjust scroll position on input but it has some
 * shortcomings for our purposes:
 *
 * 1. We'd like to have some margin between the bottom of the screen and the
 *    input text. The browser logic makes the text visible with no extra
 *    margin.
 *
 * 2. The browser doesn't know about the keyboard in our native mobile app. (Or
 *    absolutely positioned bottom bars.) We need our own offscreen testing
 *    logic to make sure text is not under the keyboard.
 */
export function useTextInputVisibilityMaintainer() {
    const routeLayout = useRouteLayout();
    const getCurrentCoveredHeight = useGetCurrentCoveredHeight();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();

    useEffect(() => {
        if (isBehindMobileFullScreenModal) return;

        const handleInput = (event: Event) => {
            if (!(event.target instanceof HTMLElement)) return;
            if (!isTextInputElement(event.target)) return;

            maintainTextInputVisibility(event.target);
        };

        const maintainTextInputVisibility = (targetElement: HTMLElement) => {
            let inputRect: {top: number; bottom: number} | undefined;

            // For `<input>`:
            if (targetElement instanceof HTMLInputElement) {
                const fullInputRect = targetElement.getBoundingClientRect();
                const inputComputedStyle = getComputedStyle(targetElement);
                const paddingTop = parseFloat(inputComputedStyle.paddingTop);
                const paddingBottom = parseFloat(inputComputedStyle.paddingBottom);

                inputRect = {
                    top: fullInputRect.top + (!isNaN(paddingTop) ? paddingTop : 0),
                    bottom: fullInputRect.bottom - (!isNaN(paddingBottom) ? paddingBottom : 0),
                };
            }
            // For `<div contenteditable="true">`:
            else {
                const selectionRange = document.getSelection()?.getRangeAt(0);

                if (selectionRange) {
                    if (selectionRange.getClientRects().length > 0) {
                        const selectionRect = selectionRange.getBoundingClientRect();

                        inputRect = {
                            top: selectionRect.top,
                            bottom: selectionRect.bottom,
                        };
                    }
                    // If there is no text in the selected node (e.g. for a new paragraph after you
                    // press return in `<ContentEditor>`) then `getClientRects()` will have a
                    // length of zero. So compute our own `inputRect` using the element's bounding
                    // rect and line height CSS property.
                    else if (
                        selectionRange.startContainer instanceof HTMLElement &&
                        selectionRange.startContainer === selectionRange.endContainer &&
                        selectionRange.startOffset === selectionRange.endOffset
                    ) {
                        const selectionContainerComputedStyle = getComputedStyle(
                            selectionRange.startContainer,
                        );
                        const selectionContainerRect =
                            selectionRange.startContainer.getBoundingClientRect();
                        const paddingTop = parseFloat(selectionContainerComputedStyle.paddingTop);
                        const lineHeight = parseFloat(selectionContainerComputedStyle.lineHeight);

                        inputRect = {
                            top: selectionContainerRect.top + paddingTop,
                            bottom: selectionContainerRect.top + paddingTop + lineHeight,
                        };
                    }
                }
            }

            // We couldn't figure out the bottom position of this input event...
            if (inputRect === undefined) return;

            let scrollableElement = targetElement.parentElement;
            while (scrollableElement !== null) {
                const {position, overflowY} = getComputedStyle(scrollableElement);

                // If the element is inside a container that doesn't scroll with its parent
                // scrollable element bail out.
                //
                // You can test this with `<TaskCollectionViewHeader>`. Try scrolling then
                // editing the collection name. Since the header is `position: sticky` we
                // shouldn't scroll the underlying task scroll view.
                //
                // NOTE(calebmer): Technically this should only apply if a `position: sticky`
                // element is "stuck". Sometimes a sticky element scrolls with its parent and
                // sometimes a sticky element stays in place while the view scrolls. If the
                // element is not stuck ideally we'd still adjust scroll.
                if (position === "fixed" || position === "sticky") {
                    scrollableElement = null;
                    break;
                }

                // We found our scrollable element!
                if (overflowY === "scroll" || overflowY === "auto") break;

                scrollableElement = scrollableElement.parentElement;
            }

            // The input isn't in a scrollable element.
            if (scrollableElement === null) return;

            const remPx = getRemPxWithoutListening();

            const viewportHeight = document.documentElement.getBoundingClientRect().height;

            const visibleTop =
                getElementSafeAreaInsetTopPx(targetElement) + navigationBarHeightRem * remPx;

            const visibleBottom = viewportHeight - getCurrentCoveredHeight();

            // If the input is below our covered height then don't try to maintain
            // visibility through this hook. `<MessageInput>`s in our mobile app will be
            // below the covered height because they're doing the covering.
            if (inputRect.top > visibleBottom) return;

            // Only add margin for elements that don't have a popup (`role="combobox"`
            // [implicitly has `aria-haspopup="listbox"`][1]). For elements with popups
            // we've likely already carefully scrolled them into view considering the
            // height of their popup. We may need to place the element close to the
            // keyboard if the popup is large.
            //
            // This is the case for `<TaskAssigneeInput>` and `<TaskPriorityInput>` in task
            // dense fields on mobile. They're carefully scrolled so that we can also
            // properly render `<TaskDateInput>` if the user switches to it.
            //
            // [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-haspopup
            const hasPopUp =
                targetElement.ariaHasPopup ??
                (targetElement.role === "combobox" ? "listbox" : null);

            inputRect.top -=
                (hasPopUp === null ? textInputVisibilityMaintainerMarginYRem : 0) * remPx;
            inputRect.bottom +=
                (hasPopUp === null ? textInputVisibilityMaintainerMarginYRem : 0) * remPx;

            if (inputRect.bottom > visibleBottom) {
                const scrollDelta = inputRect.bottom - visibleBottom;

                // Only scroll whole pixels. In case there are subpixel rounding issues when we
                // perform the first scroll for an input.
                if (Math.abs(scrollDelta) >= 1) {
                    const scrollTop = scrollableElement.scrollTop + Math.round(scrollDelta);

                    // NOTE(calebmer, #mobile-webkit-weirdness): Mobile WebKit appears to have a bug
                    // where updating `scrollTop` in this event updates `scrollTop` in JavaScript
                    // but doesn't update the native scroll layer? However wrapping in
                    // `requestAnimationFrame()` appears to work.
                    if (!isMobileWebKit) {
                        scrollableElement.scrollTop = scrollTop;
                        flushNavigationBarScrollEventEmitter.emit(scrollableElement);
                    } else {
                        requestAnimationFrame(() => {
                            scrollableElement.scrollTop = scrollTop;
                            flushNavigationBarScrollEventEmitter.emit(scrollableElement);
                        });
                    }
                }
            } else if (inputRect.top < visibleTop) {
                const scrollDelta = inputRect.top - visibleTop;

                // Only scroll whole pixels. In case there are subpixel rounding issues when we
                // perform the first scroll for an input.
                if (Math.abs(scrollDelta) >= 1) {
                    const scrollTop = scrollableElement.scrollTop + Math.round(scrollDelta);

                    // NOTE(calebmer, #mobile-webkit-weirdness): Mobile WebKit appears to have a bug
                    // where updating `scrollTop` in this event updates `scrollTop` in JavaScript
                    // but doesn't update the native scroll layer? However wrapping in
                    // `requestAnimationFrame()` appears to work.
                    if (!isMobileWebKit) {
                        scrollableElement.scrollTop = scrollTop;
                        flushNavigationBarScrollEventEmitter.emit(scrollableElement);
                    } else {
                        requestAnimationFrame(() => {
                            scrollableElement.scrollTop = scrollTop;
                            flushNavigationBarScrollEventEmitter.emit(scrollableElement);
                        });
                    }
                }
            }
        };

        document.addEventListener("input", handleInput, {capture: true});
        const unsubscribe = maintainTextInputVisibilityEmitter.subscribe(
            maintainTextInputVisibility,
        );
        return () => {
            document.removeEventListener("input", handleInput, {capture: true});
            unsubscribe();
        };
    }, [getCurrentCoveredHeight, isBehindMobileFullScreenModal, routeLayout]);
}
