import {style} from "@vanilla-extract/css";
import {mobilePlatformMediaQuery} from "~/shared/design/spacing";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css";

export const mobileGrey0BackgroundColorClassName = style({
    "@media": {
        [mobilePlatformMediaQuery]: {
            backgroundColor: colorSchemeVars["grey-0"],
        },
    },
});
