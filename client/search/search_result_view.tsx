import {Fragment} from "react";
import {Box} from "~/client/design/box.js";
import {SearchResult} from "~/shared/search/search_result.js";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles.js";

export const minSearchResultViewHeight = "2.75rem";

export function SearchResultView({
    result,
    isFirstEntry,
    isLastEntry,
}: {
    result: SearchResult;
    isFirstEntry: boolean;
    isLastEntry: boolean;
}) {
    return (
        <Box
            paddingX="1"
            paddingTop={isFirstEntry ? "1" : undefined}
            paddingBottom={isLastEntry ? "1" : undefined}
            style={{minHeight: minSearchResultViewHeight}}
        >
            <Box paddingX="3" borderRadius="md">
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
                    <Box fontSize="100" fontStyle="semi-bold" paddingBottom="0.5">
                        {result.title}
                    </Box>
                    <Box
                        overflow="hidden"
                        maxHeight="7"
                        color="grey-50"
                        fontSize="50"
                        style={{
                            // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                            // except IE.
                            // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            lineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            textOverflow: "ellipsis",
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
