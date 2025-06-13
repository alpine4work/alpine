import {style} from "@vanilla-extract/css";
import {mobilePlatformSelector} from "~/client/styles/core/styles_core.js";
import {
    narrowRouteLayoutDocClassName,
    titlePaddingTop,
} from "~/client/styles/other/internal/content.css.js";

export const containerClassName = style({
    zIndex: -50,
    position: "absolute",
    marginInline: "auto",
    left: 0,
    right: 0,
    top: "var(--safe-area-inset-top, 0px)",
    bottom: 0,
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
