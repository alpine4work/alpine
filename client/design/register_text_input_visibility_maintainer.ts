import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {getNavigationBarHeightRemWithoutListening} from "~/client/design/navigation_bar.js";
import {getElementSafeAreaInsetTopPx} from "~/client/design/safe_area_inset.js";
import {getCurrentCoveredHeight} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";

const marginYRem = parseRemLengthNumber(spacing["5"]);

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
export function registerTextInputVisibilityMaintainer() {
    const handleInput = (event: Event) => {
        if (!(event.target instanceof HTMLElement)) return;
        if (!isTextInputElement(event.target)) return;

        let inputRect: {top: number; bottom: number} | undefined;

        // For `<input>`:
        if (event.target instanceof HTMLInputElement) {
            const fullInputRect = event.target.getBoundingClientRect();
            const inputComputedStyle = getComputedStyle(event.target);
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

        let scrollableElement = event.target.parentElement;
        while (scrollableElement !== null) {
            const {overflowY} = getComputedStyle(scrollableElement);

            // We found our scrollable element!
            if (overflowY === "scroll" || overflowY === "auto") break;

            scrollableElement = scrollableElement.parentElement;
        }

        // The input isn't in a scrollable element.
        if (scrollableElement === null) return;

        const remPx = getRemPxWithoutListening();

        inputRect.top -= marginYRem * remPx;
        inputRect.bottom += marginYRem * remPx;

        const viewportHeight = document.documentElement.getBoundingClientRect().height;

        const visibleTop =
            getElementSafeAreaInsetTopPx(event.target) +
            getNavigationBarHeightRemWithoutListening() * remPx;

        const visibleBottom = viewportHeight - getCurrentCoveredHeight();

        if (inputRect.bottom > visibleBottom) {
            const scrollDelta = inputRect.bottom - visibleBottom;

            // Only scroll whole pixels. In case there are subpixel rounding issues when we
            // perform the first scroll for an input.
            if (Math.abs(scrollDelta) >= 1) {
                const scrollTop = scrollableElement.scrollTop + scrollDelta;

                // NOTE(calebmer): Mobile WebKit appears to have a bug where updating
                // `scrollTop` in this event updates `scrollTop` in JavaScript but doesn't
                // update the native scroll layer? However wrapping in
                // `requestAnimationFrame()` appears to work.
                if (!isMobileWebKit) {
                    scrollableElement.scrollTop = scrollTop;
                } else {
                    requestAnimationFrame(() => {
                        scrollableElement!.scrollTop = scrollTop;
                    });
                }
            }
        } else if (inputRect.top < visibleTop) {
            const scrollDelta = inputRect.top - visibleTop;

            // Only scroll whole pixels. In case there are subpixel rounding issues when we
            // perform the first scroll for an input.
            if (Math.abs(scrollDelta) >= 1) {
                const scrollTop = scrollableElement.scrollTop + scrollDelta;

                // NOTE(calebmer): Mobile WebKit appears to have a bug where updating
                // `scrollTop` in this event updates `scrollTop` in JavaScript but doesn't
                // update the native scroll layer? However wrapping in
                // `requestAnimationFrame()` appears to work.
                if (!isMobileWebKit) {
                    scrollableElement.scrollTop = scrollTop;
                } else {
                    requestAnimationFrame(() => {
                        scrollableElement!.scrollTop = scrollTop;
                    });
                }
            }
        }
    };

    document.addEventListener("input", handleInput, {capture: true});
    return () => {
        document.removeEventListener("input", handleInput, {capture: true});
    };
}
