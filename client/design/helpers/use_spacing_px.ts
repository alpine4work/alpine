import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {Spacing, convertRemLengthToPx, spacing as spacingMap} from "~/shared/design/spacing";

/**
 * Get the number of pixels in our `Spacing` value.
 *
 * Returns null when the hook runs on the server since the server does not know
 * the browser window size.
 */
export function useSpacingPx(spacing: Spacing): number | null {
    const remPx = useRemPx();
    if (remPx === null) return null;
    return convertRemLengthToPx(spacingMap[spacing], remPx);
}
