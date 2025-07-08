import {peekNarrowLayoutWidth} from "~/client/styles/peek_shared_styles.js";
import {contentStyles, fontSizes} from "~/client/styles/styles.js";
import {
    RemLength,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
} from "~/shared/design/core/spacing.js";
import {allSpacingScales} from "~/shared/design/core/spacing_scale.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";

export const searchMobileInputFontSize = "100";
export const searchMobileInputPaddingX = "3";
export const searchMobileInputPaddingY = "2";

// We add some margin above the search input to make sure the iOS text
// selection lollipops the cursor doesn't get clipped by the
// navigation bar.
export const searchMobileInputMarginTop = "1";

export const searchMobileInputMarginBottom = "3";

export const searchMobileInputMinHeight = addRemLengths(
    searchMobileInputPaddingY,
    fontSizes[searchMobileInputFontSize].lineHeight,
    searchMobileInputPaddingY,
);

export const searchMobileInputBorderRadius = `${parseRemLength(searchMobileInputMinHeight) / 2}rem`;

export const searchEntitySideBarWidth = "96";

export const searchModalInputHeight = "16";
export const searchModalPeekContentMaxHeight = "160";

export const searchModalMaxWidth = addRemLengths(searchEntitySideBarWidth, peekNarrowLayoutWidth);
export const searchModalMaxHeight = addRemLengths(
    searchModalInputHeight,
    searchModalPeekContentMaxHeight,
);

/**
 * Minimum height of the body text snippet in a search result. We show at least
 * two lines when there's no title and zero lines when there is a title.
 *
 * The minimum height of our `<SearchEntityView>` determines the size of our
 * search request. More items in our search request means higher search
 * latency. At least 2 lines means we need to load less data to fill the
 * virtualization window.
 */
export const searchEntityViewBodyTextSnippetMinLineCount = 1;

export const searchEntityViewPaddingY = "2";
export const searchEntityViewBodyTextSnippetFontSize = "75";
export const searchEntityViewTitleFontSize = "100";
export const searchEntityViewTitleLineHeightPx = contentStyles.paragraphLineHeightPx;
export const searchEntityViewTitleMarginBottom = "0.5";
export const searchEntityViewMediaSize = "4";
export const searchEntityViewDefaultMarginX = "1";
export const searchEntityViewDefaultPaddingX = "2.5";

export const searchEntityViewBodyTextSnippetMinHeight: RemLength = `${
    parseRemLength(fontSizes[searchEntityViewBodyTextSnippetFontSize].lineHeight) *
    searchEntityViewBodyTextSnippetMinLineCount
}rem`;

export const searchEntityViewMinHeightWithoutPaddingYPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        Math.min(
            contentStyles.paragraphLineHeightPx[spacingScale],
            convertRemLengthToPx(searchEntityViewBodyTextSnippetMinHeight, spacingScale),
        ),
);

export const searchEntityViewMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        searchEntityViewMinHeightWithoutPaddingYPx[spacingScale] +
        convertRemLengthToPx(searchEntityViewPaddingY, spacingScale) * 2,
);

export const searchAffinityEntityViewMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        contentStyles.paragraphLineHeightPx[spacingScale] +
        convertRemLengthToPx(searchEntityViewPaddingY, spacingScale) * 2,
);

// Intentionally the same value as the gap between icons and text in
// `<MenuItem>`. Since in the mention overlay you'll see search entities mixed
// with regular `<MenuItem>`s and we want their text to be aligned.
export const searchEntityViewTitleTypeDisplayGap = "2";

export const searchEntityHeaderFontSize = "50";
export const searchEntityHeaderLineHeight = "4";
export const searchEntityHeaderPaddingTop = "3";
