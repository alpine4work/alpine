import {peekNarrowLayoutWidthRem} from "~/client/styles/peek_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {screenPaddingXRem} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {ClientInfo} from "~/shared/remix/client_info.js";

export function getContentBlockWidth({
    spacingScale,
    platform,
    routeLayout,
    clientInfo,
    withoutBlockMaxWidth,
}: {
    spacingScale: SpacingScale;
    platform: Platform;
    routeLayout: RouteLayout;
    clientInfo: ClientInfo;
    withoutBlockMaxWidth: boolean;
}) {
    const remPx = remPxBySpacingScale[spacingScale];
    const screenPaddingX = screenPaddingXRem[platform] * remPx;
    const screenPaddingXDoubled = screenPaddingX * 2;

    // Shrink to the screen width if it's smaller than the max block width. Which
    // will typically be the case on mobile.
    let blockWidth = clientInfo.screenWidth - screenPaddingXDoubled;

    if (!withoutBlockMaxWidth) {
        const newBlockWidth = contentStyles.blockMaxWidthRem[platform] * remPx;

        if (newBlockWidth < blockWidth) {
            blockWidth = newBlockWidth;
        }
    }

    // Shrink to the peek narrow layout width if we're in a narrow route layout on
    // desktop (this implies we're in a peek, either the peek stack or search
    // modal).
    if (platform !== "mobile" && routeLayout === "narrow") {
        const newBlockWidth = peekNarrowLayoutWidthRem * remPx - screenPaddingXDoubled;

        if (newBlockWidth < blockWidth) {
            blockWidth = newBlockWidth;
        }
    }

    return blockWidth;
}
