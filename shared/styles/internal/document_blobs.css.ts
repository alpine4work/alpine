import {style} from "@vanilla-extract/css";
import {mobilePlatformMediaQuery} from "~/shared/design/spacing";
import {
    desktopTitlePaddingTop,
    mobileTitlePaddingTop,
} from "~/shared/styles/internal/content_schema.css";

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
});
