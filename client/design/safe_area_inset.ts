import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {InternalError} from "~/shared/error/error.js";

/**
 * Get the value of the `--safe-area-inset-top` CSS variable in pixels.
 */
export function getElementSafeAreaInsetTopPx(element: Element): number {
    const safeAreaInsetTop = getComputedStyle(element).getPropertyValue("--safe-area-inset-top");
    if (!safeAreaInsetTop) return 0;

    const safeAreaInsetTopNumber = parseFloat(safeAreaInsetTop);

    if (safeAreaInsetTop.endsWith("px")) return safeAreaInsetTopNumber;
    if (safeAreaInsetTop.endsWith("rem"))
        return safeAreaInsetTopNumber * getRemPxWithoutListening();

    throw new InternalError("Unrecognized unit for CSS variable `--safe-area-inset-top`");
}

/**
 * Get the value of the `--safe-area-inset-bottom` CSS variable in pixels.
 */
export function getElementSafeAreaInsetBottomPx(element: Element): number {
    const safeAreaInsetBottom = getComputedStyle(element).getPropertyValue(
        "--safe-area-inset-bottom",
    );
    if (!safeAreaInsetBottom) return 0;

    const safeAreaInsetBottomNumber = parseFloat(safeAreaInsetBottom);

    if (safeAreaInsetBottom.endsWith("px")) return safeAreaInsetBottomNumber;
    if (safeAreaInsetBottom.endsWith("rem"))
        return safeAreaInsetBottomNumber * getRemPxWithoutListening();

    throw new InternalError("Unrecognized unit for CSS variable `--safe-area-inset-bottom`");
}

/**
 * Get the value of the `--window-safe-area-inset-bottom` CSS variable in
 * pixels.
 */
export function getElementWindowSafeAreaInsetBottomPx(element: Element): number {
    const windowSafeAreaInsetBottom = getComputedStyle(element).getPropertyValue(
        "--window-safe-area-inset-bottom",
    );
    if (!windowSafeAreaInsetBottom) return 0;

    const windowSafeAreaInsetBottomNumber = parseFloat(windowSafeAreaInsetBottom);

    if (windowSafeAreaInsetBottom.endsWith("px")) return windowSafeAreaInsetBottomNumber;
    if (windowSafeAreaInsetBottom.endsWith("rem"))
        return windowSafeAreaInsetBottomNumber * getRemPxWithoutListening();

    throw new InternalError("Unrecognized unit for CSS variable `--window-safe-area-inset-bottom`");
}
