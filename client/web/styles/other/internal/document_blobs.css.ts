import {style} from "@vanilla-extract/css";
import {mobilePlatformSelector} from "~/client/web/styles/core/styles_core.js";
import {
    narrowRouteLayoutDocClassName,
    titlePaddingTop,
} from "~/client/web/styles/other/internal/content.css.js";

export const blobsClassName = style({
    zIndex: -50,
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: "100%",
    "@media": {},
    selectors: {
        [`${narrowRouteLayoutDocClassName} &`]: {
            top: `calc(${titlePaddingTop.desktopNarrow} - ${titlePaddingTop.desktopWide} + var(--safe-area-inset-top, 0px)))`,
        },
        [`${mobilePlatformSelector} &, ${mobilePlatformSelector} ${narrowRouteLayoutDocClassName} &`]:
            {
                top: `calc(${titlePaddingTop.mobileNarrow} - ${titlePaddingTop.desktopWide} + var(--safe-area-inset-top, 0px)))`,
            },
    },
});
