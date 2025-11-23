import {getRemPxWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {InternalError} from "~/shared/error/error.js";

/**
 * Get the value of the `--safe-area-inset-top` CSS variable in pixels.
 */
export function getElementSafeAreaInsetTopPx(element: Element): number {
    const safeAreaInsetTop = getComputedStyle(element).getPropertyValue("--safe-area-inset-top");
    if (!safeAreaInsetTop) return 0;

    // Detect the `calc()` syntax used by when the `inbox=show` search param is set
    // (see `s.$spaceId.peek.tsx`).
    const safeAreaInsetTopCalcMatch = safeAreaInsetTop.match(
        /^calc\((\d+\.?\d*)(rem|px) \+ (\d+\.?\d*)(rem|px)\)$/,
    );
    if (safeAreaInsetTopCalcMatch) {
        return (
            parseFloat(safeAreaInsetTopCalcMatch[1]!) *
                (safeAreaInsetTopCalcMatch[2] === "rem" ? getRemPxWithoutListening() : 1) +
            parseFloat(safeAreaInsetTopCalcMatch[3]!) *
                (safeAreaInsetTopCalcMatch[4] === "rem" ? getRemPxWithoutListening() : 1)
        );
    }

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
