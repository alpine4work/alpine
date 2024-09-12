import {style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/styles/internal/color_scheme.css.js";
import {screenPaddingXWithoutBlockPaddingX} from "~/client/styles/internal/content.css.js";
import {mobilePlatformSelector} from "~/client/styles/internal/platform.css.js";
import {spacing} from "~/shared/design/spacing.js";

export const documentContentClassName = style({
    paddingBottom: `calc(${spacing["24"]} + var(--safe-area-inset-bottom, 0px))`,
    paddingLeft: spacing[screenPaddingXWithoutBlockPaddingX.desktop],
    paddingRight: spacing[screenPaddingXWithoutBlockPaddingX.desktop],
    backgroundColor: colorSchemeVars["grey-0"],
    selectors: {
        [`${mobilePlatformSelector} &`]: {
            paddingLeft: spacing[screenPaddingXWithoutBlockPaddingX.mobile],
            paddingRight: spacing[screenPaddingXWithoutBlockPaddingX.mobile],
        },
    },
});
