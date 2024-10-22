import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {
    Spacing,
    convertRemLengthToPx,
    spacing as spacingMap,
} from "~/shared/design/core/spacing.js";

/**
 * Get the number of pixels in our `Spacing` value.
 *
 * When server-side rendering we will use the screen width in our client info
 * cookie. If that screen width is inconsistent with the actual browser the
 * user may see a flash after server-side rendering so be careful. If the
 * screen width is unknown, we assume a desktop platform.
 */
export function useSpacingPx(spacing: Spacing): number {
    const remPx = useRemPx();
    return convertRemLengthToPx(spacingMap[spacing], remPx);
}
