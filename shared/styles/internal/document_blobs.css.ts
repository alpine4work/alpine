import {style} from "@vanilla-extract/css";
import {mobilePlatformMediaQuery} from "~/shared/design/spacing.js";
import {
    desktopTitlePaddingTop,
    docMobileLayoutContainerClassName,
    mobileLayoutTitlePaddingTop,
    mobilePlatformTitlePaddingTop,
} from "~/shared/styles/internal/content_schema.css.js";

export const blobsClassName = style({
    zIndex: -50,
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: "100%",
    "@media": {
        [mobilePlatformMediaQuery]: {
            top: `calc(${mobilePlatformTitlePaddingTop} - ${desktopTitlePaddingTop} + var(--safe-area-inset-top, 0px)))`,
            selectors: {
                [`${docMobileLayoutContainerClassName} &`]: {
                    top: `calc(${mobilePlatformTitlePaddingTop} - ${desktopTitlePaddingTop} + var(--safe-area-inset-top, 0px)))`,
                },
            },
        },
    },
    selectors: {
        [`${docMobileLayoutContainerClassName} &`]: {
            top: `calc(${mobileLayoutTitlePaddingTop} - ${desktopTitlePaddingTop} + var(--safe-area-inset-top, 0px)))`,
        },
    },
});
