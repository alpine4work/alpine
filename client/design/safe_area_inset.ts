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
