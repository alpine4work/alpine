import {contentStyles, fontSizes} from "~/client/styles/styles.js";
import {
    RemLength,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
} from "~/shared/design/core/spacing.js";
import {allSpacingScales, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";

export const searchMobileInputFontSize = "100";
export const searchMobileInputPaddingX = "3";
export const searchMobileInputPaddingY = "2";

// We add some margin above the search input to make sure the iOS text
// selection lollipops the cursor doesn't get clipped by the
// navigation bar.
export const searchMobileInputMarginTop = "1";

export const searchMobileInputMarginBottom = "3";

export const minSearchMobileInputHeight = addRemLengths(
    searchMobileInputPaddingY,
    fontSizes[searchMobileInputFontSize].lineHeight,
    searchMobileInputPaddingY,
);

export const searchMobileInputBorderRadius = `${parseRemLength(minSearchMobileInputHeight) / 2}rem`;

/**
 * Minimum height of the body text snippet in a search result. We show at least
 * two lines when there's no title and zero lines when there is a title.
 *
 * The minimum height of our `<SearchResultView>` determines the size of our
 * search request. More items in our search request means higher search
 * latency. At least 2 lines means we need to load less data to fill the
 * virtualization window.
 */
export const minSearchResultViewBodyTextSnippetLineCount = 1;

export const searchResultViewPaddingY = "2";
export const searchResultViewBodyTextSnippetFontSize = "75";
export const searchResultViewTitleFontSize = "100";
export const searchResultViewTitleLineHeightPx = contentStyles.paragraphLineHeightPx;
export const searchResultViewTitleMarginBottom = "1";

export const searchResultViewMediaSize = "4";
export const searchResultViewAuxiliaryTypeDisplaySize = "3";
export const searchResultViewAuxiliaryTypeDisplayOffset: RemLength = `${
    9 / remPxBySpacingScale.small
}rem`;

export const minSearchResultViewBodyTextSnippetHeight: RemLength = `${
    parseRemLength(fontSizes[searchResultViewBodyTextSnippetFontSize].lineHeight) *
    minSearchResultViewBodyTextSnippetLineCount
}rem`;

export const minSearchResultViewHeightWithoutPaddingYPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        Math.min(
            searchResultViewTitleLineHeightPx[spacingScale],
            convertRemLengthToPx(minSearchResultViewBodyTextSnippetHeight, spacingScale),
        ),
);

export const minSearchResultViewHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        minSearchResultViewHeightWithoutPaddingYPx[spacingScale] +
        convertRemLengthToPx(searchResultViewPaddingY, spacingScale) * 2,
);
