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
 * Returns the pixel width of a block of content in either <ContentEditor> or
 * <ContentView>. Normally, a block's width is determined by CSS (particularly
 * something like `width: 100%; max-width: var(--max-block-width);` see
 * `blockStyles` in `content.css.ts`). However, sometimes we need to know the
 * block width at render time to properly layout certain views. Namely file
 * rows and tables. This function computes the block width with information
 * available at render time (it also runs on the server).
 *
 * This function isn't perfect. Namely, if you have a large screen width but a
 * window width that's narrower than the max block width, a block with the CSS
 * `width: 100%;` will be the window width. However, this function will return
 * the max block width. Leading to file rows or tables being lain out assuming a
 * larger block width than what we actually have available.
 *
 * It's unclear how to fix this issue. We don't know the window width at server
 * render time. The window width can change between different web browser tabs
 * (unlike the screen width which is why the screen width is in `ClientInfo`
 * but not the window width). We think the current calculation, even with its
 * inaccuracies, is good enough for now and can make the calculation more
 * specific as we find problematic bugs that arise from an occasionally
 * inaccurate block width calculation.
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
