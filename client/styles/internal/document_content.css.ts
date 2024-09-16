import {style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/styles/internal/color_scheme.css.js";
import {mobilePlatformSelector} from "~/client/styles/internal/platform.css.js";
import {screenPaddingX, spacing} from "~/shared/design/spacing.js";

export const documentContentClassName = style({
    paddingBottom: `calc(${spacing["24"]} + var(--safe-area-inset-bottom, 0px))`,
    paddingLeft: spacing[screenPaddingX.desktop],
    paddingRight: spacing[screenPaddingX.desktop],
    backgroundColor: colorSchemeVars["grey-0"],
    selectors: {
        [`${mobilePlatformSelector} &`]: {
            paddingLeft: spacing[screenPaddingX.mobile],
            paddingRight: spacing[screenPaddingX.mobile],
        },
    },
});
