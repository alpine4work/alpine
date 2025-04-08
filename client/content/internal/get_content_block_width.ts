import {peekNarrowLayoutWidthRem} from "~/client/styles/peek_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {
    ParsableRemLength,
    convertRemLengthToPx,
    screenPaddingXRem,
} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {ClientInfo} from "~/shared/remix/client_info.js";

/**
 * Returns the pixel width of the content block with respect to
 * platform, route layout, and client info.
 */
export function getContentBlockWidth({
    spacingScale,
    platform,
    routeLayout,
    clientInfo,
    availableWidth = null,
    withoutBlockMaxWidth = false,
    transformScale = 1,
}: {
    spacingScale: SpacingScale;
    platform: Platform;
    routeLayout: RouteLayout;
    clientInfo: ClientInfo;
    availableWidth?: ParsableRemLength | number | null;
    withoutBlockMaxWidth?: boolean;
    transformScale?: number;
}) {
    const remPx = remPxBySpacingScale[spacingScale];
    const screenPaddingX = screenPaddingXRem[platform] * remPx;
    const screenPaddingXDoubled = screenPaddingX * 2;

    let blockWidth = (clientInfo.screenWidth - screenPaddingXDoubled) / transformScale;

    // Shrink to the peek narrow layout width if we're in a narrow route layout on
    // desktop (this implies we're in a peek, either the peek stack or search
    // modal).
    if (platform !== "mobile" && routeLayout === "narrow") {
        const newBlockWidth =
            (peekNarrowLayoutWidthRem * remPx - screenPaddingXDoubled) / transformScale;

        if (newBlockWidth < blockWidth) {
            blockWidth = newBlockWidth;
        }
    }

    // Shrink to max block width if it's smaller than screen width. Typically,
    // screen width will be smaller than max block width on mobile.
    if (!withoutBlockMaxWidth) {
        const newBlockWidth = contentStyles.blockMaxWidthRem[platform] * remPx;

        if (newBlockWidth < blockWidth) {
            blockWidth = newBlockWidth;
        }
    }

    // Shrink to available width if set.
    if (availableWidth !== null) {
        const newBlockWidth =
            (typeof availableWidth === "number"
                ? availableWidth
                : convertRemLengthToPx(availableWidth, spacingScale)) / transformScale;

        if (newBlockWidth < blockWidth) {
            blockWidth = newBlockWidth;
        }
    }

    return blockWidth;
}
