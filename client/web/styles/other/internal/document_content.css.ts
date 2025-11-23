import {style} from "@vanilla-extract/css";
import {mobilePlatformSelector} from "~/client/web/styles/core/styles_core.js";
import * as spaceLayoutStyles from "~/client/web/styles/other/internal/space_layout.css.js";
import {screenPaddingX, screenPaddingXRem, spacing} from "~/shared/design/core/spacing.js";

export const contentClassName = style({
    paddingBottom: `calc(${spacing["24"]} + var(--safe-area-inset-bottom, 0px))`,
    paddingLeft: spacing[screenPaddingX.desktop],
    paddingRight: spacing[screenPaddingX.desktop],
    selectors: {
        [`${mobilePlatformSelector} &`]: {
            paddingLeft: spacing[screenPaddingX.mobile],
            paddingRight: spacing[screenPaddingX.mobile],
        },
    },
});

export const contentWithWideRouteLayoutClassName = style({
    selectors: {
        [`${contentClassName}&`]: {
            // Add the sidebar width in padding since we configure `spaceSideBarSpacing`
            // for the document route to be `Never`. We add it to both the left and right
            // so the document content is centered and full width elements (e.g. tables)
            // are clipped horizontally at the same place on the left and right of the
            // screen.
            paddingLeft: `calc(${spaceLayoutStyles.sideBarWidth} + ${screenPaddingXRem.desktop}rem)`,
            paddingRight: `calc(${spaceLayoutStyles.sideBarWidth} + ${screenPaddingXRem.desktop}rem)`,
        },
    },
});
