import {style} from "@vanilla-extract/css";
import {mobilePlatformMediaQuery} from "~/shared/design/spacing";
import {
    desktopTitlePaddingTop,
    mobileOrPeekTitlePaddingTop,
} from "~/shared/styles/internal/content_schema.css";
import {peekContainerClassName} from "~/shared/styles/internal/peek.css";

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
            top: `calc(${mobileOrPeekTitlePaddingTop} - ${desktopTitlePaddingTop})`,
        },
    },
    selectors: {
        [`${peekContainerClassName} &`]: {
            top: `calc(${mobileOrPeekTitlePaddingTop} - ${desktopTitlePaddingTop})`,
        },
    },
});
