import {hasTouchPoints} from "~/client/web/helpers/browser/has_touch_points.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";

// Null means the virtual keyboard API is not available so use other mechanisms
// for telling whether the virtual keyboard is open.
let isVirtualKeyboardVisible: boolean | null = null;

// The virtual keyboard API tells us exactly what we want...but it's only
// implemented by Chrome.
// https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard
if (typeof navigator !== "undefined" && "virtualKeyboard" in navigator) {
    const updateIsVirtualKeyboardVisible = () => {
        const boundingRect: DOMRect = (navigator as any).virtualKeyboard.boundingRect;
        isVirtualKeyboardVisible = boundingRect.width > 0 && boundingRect.height > 0;
    };

    updateIsVirtualKeyboardVisible();

    (navigator as any).virtualKeyboard.addEventListener(
        "geometrychange",
        updateIsVirtualKeyboardVisible,
    );
}

/**
 * Did the provided keyboard event come from a physical keyboard or virtual
 * keyboard (e.g. the touchscreen keyboard on iOS)?
 *
 * Because iOS Safari (booooo) doesn't give us an API for interacting with the
 * virtual keyboard unlike [Chrome][1] this function is heuristics based.
 * Which...is terrible and I'm crying.
 *
 * [1]: https://developer.chrome.com/docs/web-platform/virtual-keyboard/
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isVirtualKeyboardEvent(event: KeyboardEvent): boolean {
    // Use the virtual keyboard API if available.
    if (isVirtualKeyboardVisible !== null) return isVirtualKeyboardVisible;

    // If the user can not interact with the product with touch, we can confidently
    // say this event did not come from a virtual keyboard.
    if (!hasTouchPoints) return false;

    // If we're using mobile WebKit, assume all keyboard events are coming from a
    // virtual keyboard. This is not true if the user has an iPad with a physical
    // keyboard. Eventually we should test our product using one of those.
    //
    // The only approach to detecting virtual keyboards on iOS WebKit I've seen is
    // this blog post which uses keypress times...
    //
    // https://lyosha.me/blog/2016/02/12/detecting-virtual-keyboards/
    return isMobileWebKit;
}
