import {fontSizes} from "~/client/styles/styles.js";
import {RemLength, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";

export const searchMobileInputFontSize = "100";
export const searchMobileInputPaddingX = "3";
export const searchMobileInputPaddingY = "2";

// We add some margin above the search input to make sure the iOS text
// selection lollipops the cursor doesn't get clipped by the
// navigation bar.
export const searchMobileInputMarginTop = "1";

export const searchMobileInputMarginBottom = "3";

export const minSearchMobileInputHeight = addRemLengths(
    spacing[searchMobileInputPaddingY],
    fontSizes[searchMobileInputFontSize].lineHeight,
    spacing[searchMobileInputPaddingY],
);

export const searchMobileInputBorderRadius = `${
    parseRemLengthNumber(minSearchMobileInputHeight) / 2
}rem`;

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
export const minSearchResultViewBodyTextSnippetLineCountWithTitle = 0;

export const searchResultViewPaddingY = "4";
export const searchResultViewBodyTextSnippetFontSize = "75";
export const searchResultViewTitleFontSize = "100";
export const searchResultViewTitleMarginBottom = "1";
export const searchResultMediaViewSize = "9";

export const minSearchResultViewBodyTextSnippetHeight: RemLength = `${
    parseRemLengthNumber(fontSizes[searchResultViewBodyTextSnippetFontSize].lineHeight) *
    minSearchResultViewBodyTextSnippetLineCount
}rem`;

export const minSearchResultViewBodyTextSnippetHeightWithTitle: RemLength = `${
    parseRemLengthNumber(fontSizes[searchResultViewBodyTextSnippetFontSize].lineHeight) *
    minSearchResultViewBodyTextSnippetLineCountWithTitle
}rem`;

export const minSearchResultViewHeightWithoutPaddingY: RemLength = `${Math.min(
    Math.max(
        parseRemLengthNumber(spacing[searchResultMediaViewSize]),
        parseRemLengthNumber(
            addRemLengths(
                fontSizes[searchResultViewTitleFontSize].lineHeight,
                minSearchResultViewBodyTextSnippetHeightWithTitle,
            ),
        ),
    ),
    parseRemLengthNumber(addRemLengths(minSearchResultViewBodyTextSnippetHeight)),
)}rem`;

export const minSearchResultViewHeight = addRemLengths(
    spacing[searchResultViewPaddingY],
    minSearchResultViewHeightWithoutPaddingY,
    spacing[searchResultViewPaddingY],
);
