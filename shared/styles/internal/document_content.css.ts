import {style} from "@vanilla-extract/css";
import {Spacing, mobilePlatformMediaQuery, spacing} from "~/shared/design/spacing.js";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css.js";

export const desktopDocumentPaddingX: Spacing = "3";
export const mobileDocumentPaddingX: Spacing = "2";

export const documentContentClassName = style({
    paddingBottom: `calc(${spacing["24"]} + var(--safe-area-inset-bottom, 0px))`,
    paddingLeft: spacing[desktopDocumentPaddingX],
    paddingRight: spacing[desktopDocumentPaddingX],
    backgroundColor: colorSchemeVars["grey-0"],
    "@media": {
        [mobilePlatformMediaQuery]: {
            paddingLeft: spacing[mobileDocumentPaddingX],
            paddingRight: spacing[mobileDocumentPaddingX],
        },
    },
});
