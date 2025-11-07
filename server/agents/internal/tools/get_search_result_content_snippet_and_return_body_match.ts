import {findSpans as findUnicodeDefaultWordBoundarySpans} from "unicode-default-word-boundary";
import {
    ApiSearchChatMessageResult,
    ApiSearchDocumentMessageResult,
    ApiSearchPostMessageResult,
    ApiSearchResultBodyMatch,
    ApiSearchResultBodyMatchItem,
    ApiSearchTaskMessageResult,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {countGraphemes, iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {maxReasonableEnglishWordGraphemeCount} from "~/shared/helpers/string/max_reasonable_english_word_grapheme_count.js";
import {missingSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";

type ApiSearchMessageResult =
    | ApiSearchChatMessageResult
    | ApiSearchTaskMessageResult
    | ApiSearchPostMessageResult
    | ApiSearchDocumentMessageResult;

/**
 * The number of [graphemes][1] (aka characters) to include in a link label.
 *
 * Uses graphemes instead of string `length` to accurately handle Unicode
 * characters made out of multiple JavaScript characters and to ignore
 * zero-width characters.
 *
 * [1]: https://www.npmjs.com/package/grapheme-splitter
 */
const maxGraphemeCount = 50;

/**
 * Truncates body matches to a maximum grapheme count.
 *
 * The function will try to expand to the nearest word boundary if it's within
 * 14 characters (99% of English words are 14 characters or shorter).
 *
 * Returns the preview string with marks and the remaining body match
 * content that was not included in the preview.
 *
 * Example where `maxGraphemeCount` is 15:
 *
 * ```
 * bodyMatch: [
 *   {text: "Hello "},
 *   {text: "world", isMatch: true},
 *   {text: " how are you today?", isMatch: true}
 * ]
 * ```
 *
 * Returns:
 * ```
 * {
 *   preview: [
 *     {text: "John: "}, // Not counted towards `maxGraphemeCount`
 *     {text: "Hello "}, // 6 graphemes
 *     {text: "world", isMatch: true}, // 5 graphemes
 *     {text: " how", isMatch: true} // 3 graphemes
 *   ],
 *   newBodyMatch: [
 *     {text: " are you today?", isMatch: true}
 *   ],
 * }
 */
export function getSearchResultContentSnippetAndReturnBodyMatch(
    result: Pick<ApiSearchMessageResult, "bodyMatch" | "author" | "type">,
): {
    preview: ApiSearchResultBodyMatch;
    newBodyMatch: ApiSearchResultBodyMatch;
} {
    const bodyMatch = result.bodyMatch || [];
    const previewMessagePrefix = {text: `${result.author.shortName}: `} as const;

    // If there's no body match, we use the missing search entity title. It'll look something
    // like "<Author>: Unknown task comment"
    if (bodyMatch.length === 0) {
        return {
            preview: [
                previewMessagePrefix,
                {text: getMissingSearchEntityTitleForMessage(result.type)},
            ],
            newBodyMatch: [],
        };
    }

    let totalGraphemeCount = 0;
    let segmentIndex = 0;
    const preview: Array<ApiSearchResultBodyMatchItem> = [previewMessagePrefix];
    const newBodyMatch: Array<ApiSearchResultBodyMatchItem> = [];

    for (const segment of bodyMatch) {
        const text = segment.text;
        const segmentGraphemeCount = countGraphemes(text);

        // If we can add this entire segment to the preview, do so and continue to the next segment.
        if (totalGraphemeCount + segmentGraphemeCount <= maxGraphemeCount) {
            preview.push(segment);
            totalGraphemeCount += segmentGraphemeCount;
            segmentIndex++;

            continue;
        }

        // This segment doesn't fit in the preview, so we need to "split" it
        // into a preview and a newBodyMatch.
        const remainingGraphemeCount = maxGraphemeCount - totalGraphemeCount;

        if (remainingGraphemeCount > 0) {
            let truncatedText = "";
            let currentGraphemeCount = 0;

            for (const grapheme of iterateGraphemes(text)) {
                if (currentGraphemeCount >= remainingGraphemeCount) break;
                truncatedText += grapheme;
                currentGraphemeCount++;
            }

            // We've iterated through the current segment up until the max grapheme count.
            // However, we want to try to avoid splitting in the middle of a word. So we
            // "look ahead" up to 14 graphemes to see if we can find a space. If we find a
            // space, we use that space to split the segment. If we don't find a space, we'll
            // truncate midword, 14 graphemes from now. This means that the max number of
            // graphemes we'll remove from the `bodyMatch` is 50 + 14 = 64. This isn't ideal,
            // but it also isn't a big deal.
            const lookForWhiteSpaceBuffer = maxReasonableEnglishWordGraphemeCount;

            const restOfText = text.slice(currentGraphemeCount);
            const textSpansAfterMaxGraphemeCountBoundary =
                findUnicodeDefaultWordBoundarySpans(restOfText);
            const firstSpan = iterableFirst(textSpansAfterMaxGraphemeCountBoundary);

            if (firstSpan && firstSpan.length < lookForWhiteSpaceBuffer) {
                // if the first span is empty, don't add it to the truncated text
                if (firstSpan.text.trim().length > 0) truncatedText += firstSpan.text;
            } else {
                truncatedText += text.slice(
                    currentGraphemeCount,
                    currentGraphemeCount + lookForWhiteSpaceBuffer,
                );
            }

            // Add the truncated text to the preview.
            preview.push({
                ...segment,
                text: truncatedText.trimEnd(),
            });

            // Add remaining part of this segment to newBodyMatch
            const remainingText = text.slice(truncatedText.length);
            if (remainingText.length > 0) {
                newBodyMatch.push({
                    ...segment,
                    text: remainingText,
                });
            }
        } else {
            // No room left, add entire segment to newBodyMatch
            newBodyMatch.push(segment);
        }

        segmentIndex++;
        break;
    }

    // Add remaining segments to newBodyMatch
    for (let i = segmentIndex; i < bodyMatch.length; i++) {
        newBodyMatch.push(bodyMatch[i]!);
    }

    return {preview, newBodyMatch};
}

function getMissingSearchEntityTitleForMessage(
    type: "ChatMessage" | "DocumentMessage" | "PostMessage" | "TaskMessage",
): string {
    switch (type) {
        case "ChatMessage":
            return `${missingSearchEntityTitle} chat message`;
        case "DocumentMessage":
            return `${missingSearchEntityTitle} document comment`;
        case "PostMessage":
            return `${missingSearchEntityTitle} post comment`;
        case "TaskMessage":
            return `${missingSearchEntityTitle} task comment`;
        default:
            throw exhaustive(type);
    }
}
