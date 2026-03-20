import {globalStyle, style} from "@vanilla-extract/css";
import {fontSizes, mobilePlatformSelector} from "~/client/web/styles/core/styles_core.js";
import {titleFontSize} from "~/client/web/styles/other/internal/content.css.js";
import * as spaceLayoutStyles from "~/client/web/styles/other/internal/space_layout.css.js";
import {titleClassName} from "~/shared/design/core/constant_class_names.js";
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
            // Add the sidebar width in padding since we configure `spaceSideBarSpacing` for
            // the document route to be `Never`. We add it to both the left and right so the
            // document content is centered and full width elements (e.g. tables) are clipped
            // horizontally at the same place on the left and right of the screen.
            paddingLeft: `calc(${spaceLayoutStyles.sideBarWidth} + ${screenPaddingXRem.desktop}rem)`,
            paddingRight: `calc(${spaceLayoutStyles.sideBarWidth} + ${screenPaddingXRem.desktop}rem)`,
        },
    },
});

export const printContentClassName = style({
    selectors: {
        [`${contentClassName}&&`]: {
            paddingLeft: 0,
            paddingRight: 0,
            paddingBottom: 0,
        },
    },
});

globalStyle(`${contentClassName}${printContentClassName} ${titleClassName}`, {
    // Turn off padding top on titles when we print so we don't waste printer ink. We
    // add 0.25in of margin top to the `body` in `/print/document/:documentId` for more
    // reasonable margins.
    paddingTop: 0,
    minHeight: fontSizes[titleFontSize.wide].lineHeight,
});

globalStyle(`${printContentClassName} *`, {
    "@media": {
        print: {
            // Make sure when we print we tell the browser to preserve `background-color`s. A
            // lot in our app depends on `background-color` (like unordered list bullets).
            printColorAdjust: "exact",
        },
    },
});
