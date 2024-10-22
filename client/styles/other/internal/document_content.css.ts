import {style} from "@vanilla-extract/css";
import {colorSchemeVars, mobilePlatformSelector} from "~/client/styles/core/styles_core.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";

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
