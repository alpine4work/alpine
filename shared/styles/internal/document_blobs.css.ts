import {style} from "@vanilla-extract/css";
import {mobilePlatformMediaQuery} from "~/shared/design/spacing.js";
import {
    desktopTitlePaddingTop,
    mobileTitlePaddingTop,
} from "~/shared/styles/internal/content_schema.css.js";
import {peekWithMobileLayoutContainerClassName} from "~/shared/styles/internal/peek.css.js";

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
            top: `calc(${mobileTitlePaddingTop} - ${desktopTitlePaddingTop})`,
        },
    },
    selectors: {
        [`${peekWithMobileLayoutContainerClassName} &`]: {
            top: `calc(${mobileTitlePaddingTop} - ${desktopTitlePaddingTop})`,
        },
    },
});
