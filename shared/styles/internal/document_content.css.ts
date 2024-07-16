import {style} from "@vanilla-extract/css";
import {spacing} from "~/shared/design/spacing.js";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css.js";
import {screenPaddingXWithoutBlockPaddingX} from "~/shared/styles/internal/content_schema.css.js";
import {mobilePlatformSelector} from "~/shared/styles/internal/platform.css.js";

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
