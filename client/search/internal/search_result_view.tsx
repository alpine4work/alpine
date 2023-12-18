import {Fragment} from "react";
import {Box} from "~/client/design/box.js";
import {RemLength, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {SearchResult} from "~/shared/search/search_result.js";
import {colorSchemeVars, fontSizes, sprinkles} from "~/shared/styles/styles.js";

/**
 * Minimum height of the body text snippet in a search result. We show at least
 * two lines.
 *
 * The minimum height of our `<SearchResultView>` determines the size of our
 * search request. More items in our search request means higher search
 * latency. At least 2 lines means we need to load less data to fill the
 * virtualization window.
 */
const minSearchBodyTextSnippetLineCount = 2;

const searchBodyTextSnippetFontSize = "50";

const minSearchBodyTextSnippetHeight: RemLength = `${
    parseRemLengthNumber(fontSizes[searchBodyTextSnippetFontSize].lineHeight) *
    minSearchBodyTextSnippetLineCount
}rem`;

export const minSearchResultViewHeight = addRemLengths(
    spacing["3"],
    fontSizes["100"].lineHeight,
    spacing["0.5"],
    minSearchBodyTextSnippetHeight,
    spacing["3"],
);

export function SearchResultView({
    result,
    isSelected,
    isFirstEntry,
    isLastEntry,
    onPressStart,
}: {
    result: SearchResult;
    isSelected: boolean;
    isFirstEntry: boolean;
    isLastEntry: boolean;
    onPressStart: () => void;
}) {
    return (
        <Box
            paddingX="1"
            paddingTop={isFirstEntry ? "1" : undefined}
            paddingBottom={isLastEntry ? "1" : undefined}
            style={{minHeight: minSearchResultViewHeight}}
            onPointerDown={() => {
                onPressStart?.();
            }}
        >
            <Box
                paddingX="3"
                borderRadius="md"
                backgroundColor={isSelected ? "grey-5" : undefined}
                style={{
                    // Add an extra pixel of padding so the background color covers the
                    // border rendered with `boxShadow`.
                    paddingBottom: 1,
                    marginBottom: -1,
                }}
            >
                <Box
                    paddingY="3"
                    style={{
                        // Draw border with a `box-shadow` instead of `border` so it doesn't contribute
                        // 1px to layout. Layout needs to be precise since this is rendered in a
                        // virtualized list.
                        boxShadow: !isLastEntry
                            ? `0 1px 0 0 ${colorSchemeVars["grey-5"]}`
                            : undefined,
                    }}
                >
                    <Box
                        overflow="hidden"
                        fontSize="100"
                        fontStyle="semi-bold"
                        paddingBottom="0.5"
                        style={{
                            minHeight: fontSizes["100"].lineHeight,
                            // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                            // except IE.
                            // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            lineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            textOverflow: "ellipsis",
                            // Render contextual alternate glyphs. Particularly important that we render
                            // the right "@" for mentions.
                            fontFeatureSettings: '"calt" on',
                        }}
                    >
                        {result.title}
                    </Box>
                    <Box
                        overflow="hidden"
                        color="grey-50"
                        fontSize={searchBodyTextSnippetFontSize}
                        style={{
                            // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                            // except IE.
                            // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            lineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            textOverflow: "ellipsis",
                            // Render contextual alternate glyphs. Particularly important that we render
                            // the right "@" for mentions.
                            fontFeatureSettings: '"calt" on',
                            minHeight: minSearchBodyTextSnippetHeight,
                        }}
                    >
                        {result.bodyTextSnippet.map(({isHighlighted, text}, index) => {
                            if (!isHighlighted) {
                                return <Fragment key={index}>{text}</Fragment>;
                            } else {
                                return (
                                    <span
                                        key={index}
                                        className={sprinkles({
                                            color: "grey-text",
                                            fontStyle: "semi-bold",
                                        })}
                                    >
                                        {text}
                                    </span>
                                );
                            }
                        })}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
