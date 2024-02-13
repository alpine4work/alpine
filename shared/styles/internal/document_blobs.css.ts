import {style} from "@vanilla-extract/css";
import {mobilePlatformMediaQuery} from "~/shared/design/spacing.js";
import {
    desktopTitlePaddingTop,
    docMobileLayoutContainerClassName,
    mobileTitlePaddingTop,
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
            top: `calc(${mobileTitlePaddingTop} - ${desktopTitlePaddingTop} + var(--safe-area-inset-top, 0px)))`,
        },
    },
    selectors: {
        [`${docMobileLayoutContainerClassName} &`]: {
            top: `calc(${mobileTitlePaddingTop} - ${desktopTitlePaddingTop} + var(--safe-area-inset-top, 0px)))`,
        },
    },
});
