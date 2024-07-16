import {style} from "@vanilla-extract/css";
import {
    desktopTitlePaddingTop,
    mobileLayoutTitlePaddingTop,
    mobilePlatformTitlePaddingTop,
    withMobileLayoutDocClassName,
} from "~/shared/styles/internal/content_schema.css.js";
import {mobilePlatformSelector} from "~/shared/styles/internal/platform.css.js";

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
        [`${withMobileLayoutDocClassName} &`]: {
            top: `calc(${mobileLayoutTitlePaddingTop} - ${desktopTitlePaddingTop} + var(--safe-area-inset-top, 0px)))`,
        },
        [`${mobilePlatformSelector} &, ${mobilePlatformSelector} ${withMobileLayoutDocClassName} &`]:
            {
                top: `calc(${mobilePlatformTitlePaddingTop} - ${desktopTitlePaddingTop} + var(--safe-area-inset-top, 0px)))`,
            },
    },
});
