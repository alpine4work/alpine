import {style} from "@vanilla-extract/css";
import {
    largeSpacingScaleSelector,
    mediumSpacingScaleSelector,
} from "~/client/web/styles/core/styles_core.js";
import {paragraphLineHeightVar} from "~/client/web/styles/other/internal/content.css.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";

// NOTE(calebmer): I'm not entirely sold on this design choice for search
// results with a body but no title. We need to show the search result media on
// the first line (which requires a large line height) so we increase the line
// height of just the first line of body text. Then we also increase the font
// size of the first line of body text a bit otherwise the gap between the
// first line and the rest of the content looks weird.
//
// This is the best I can think of right now. Maybe we should work towards
// always having a title for all search results.
export const bodyTextSnippetWithoutTitleClassName = style({
    selectors: {
        "&::first-line": {
            fontSize: fontSizesBySpacingScale["75"].small.fontSize + 1,
            lineHeight: paragraphLineHeightVar,
        },
        [`${mediumSpacingScaleSelector} &::first-line`]: {
            fontSize: fontSizesBySpacingScale["75"].medium.fontSize + 1,
        },
        [`${largeSpacingScaleSelector} &::first-line`]: {
            fontSize: fontSizesBySpacingScale["75"].large.fontSize + 1,
        },
    },
});
