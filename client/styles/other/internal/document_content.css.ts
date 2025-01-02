import {style} from "@vanilla-extract/css";
import {mobilePlatformSelector} from "~/client/styles/core/styles_core.js";
import * as spaceLayoutStyles from "~/client/styles/other/internal/space_layout.css.js";
import {screenPaddingX, screenPaddingXRem, spacing} from "~/shared/design/core/spacing.js";

export const contentClassName = style({
    paddingBottom: `calc(${spacing["24"]} + var(--safe-area-inset-bottom, 0px))`,
    // Add padding so that when the sidebar width is 0 we have an equivalent amount
    // of padding in our `<DocumentContentEditor>`. That way content within the
    // editor isn't rendered underneath the space layout sidebar. This is important
    // for wide tables which extend to the edge of the content editor.
    paddingLeft: `calc(${spaceLayoutStyles.sideBarWidth} - ${spaceLayoutStyles.sideBarSpace} + ${screenPaddingXRem.desktop}rem)`,
    paddingRight: `calc(${spaceLayoutStyles.sideBarWidth} - ${spaceLayoutStyles.sideBarSpace} + ${screenPaddingXRem.desktop}rem)`,
    selectors: {
        [`${mobilePlatformSelector} &`]: {
            paddingLeft: spacing[screenPaddingX.mobile],
            paddingRight: spacing[screenPaddingX.mobile],
        },
    },
});
