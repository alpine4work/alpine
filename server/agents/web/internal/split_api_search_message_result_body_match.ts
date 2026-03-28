import {
    ApiSearchChatMessageResultResponse,
    ApiSearchDocumentMessageResultResponse,
    ApiSearchPostMessageResultResponse,
    ApiSearchResultBodyMatch,
    ApiSearchTaskMessageResultResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {maxReasonableEnglishWordGraphemeCount} from "~/shared/helpers/string/max_reasonable_english_word_grapheme_count.js";

/**
 * A search result for a message in some room: a chat message, a document comment,
 * a post comment, or a task comment.
 */
export type ApiSearchMessageResultResponse =
    | ApiSearchChatMessageResultResponse
    | ApiSearchTaskMessageResultResponse
    | ApiSearchPostMessageResultResponse
    | ApiSearchDocumentMessageResultResponse;

type ApiSearchResultBodyMatchItem = ApiSearchResultBodyMatch[number];

/**
 * The number of [graphemes][1] (aka characters) to include in a link label before
 * looking for a word boundary.
 *
 * Uses graphemes instead of string `length` to accurately handle Unicode
 * characters made out of multiple JavaScript characters and to ignore zero-width
 * characters.
 *
 * Same as `maxLabelStringLength`.
 *
 * [1]: https://www.npmjs.com/package/grapheme-splitter
 */
const softMaxGraphemeCount = 50;

/**
 * The maximum link label length when there isn't a word boundary after the soft
 * maximum.
 */
const hardMaxGraphemeCount = softMaxGraphemeCount + maxReasonableEnglishWordGraphemeCount;

/**
 * Splits a message search result body match into a preview and the remaining body
 * match content that was not included in the preview.
 *
 * The preview ends at the first whitespace after the soft maximum grapheme count,
 * or at the hard maximum grapheme count when no whitespace follows.
 */
export function splitApiSearchMessageResultBodyMatch(
    result: Pick<ApiSearchMessageResultResponse, "bodyMatch" | "type">,
): {
    preview: ApiSearchResultBodyMatch;
    newBodyMatch: ApiSearchResultBodyMatch;
} {
    const bodyMatch = result.bodyMatch || [];

    // If there's no body match, use the missing search entity title.
    if (bodyMatch.length === 0) {
        return {
            preview: [{text: getMissingSearchEntityTitleForMessage(result.type)}],
            newBodyMatch: [],
        };
    }

    let totalGraphemeCount = 0;
    let segmentIndex = 0;
    const preview: Array<ApiSearchResultBodyMatchItem> = [];
    const newBodyMatch: Array<ApiSearchResultBodyMatchItem> = [];

    for (const segment of bodyMatch) {
        let length = 0;
        let isTruncated = false;

        for (const grapheme of iterateGraphemes(segment.text)) {
            // Truncate after the hard break max grapheme count.
            if (totalGraphemeCount >= hardMaxGraphemeCount) {
                isTruncated = true;
                break;
            }

            // Break at the first whitespace we see after the soft max grapheme count.
            if (
                totalGraphemeCount >= softMaxGraphemeCount &&
                /^\p{White_Space}+$/u.test(grapheme)
            ) {
                isTruncated = true;
                break;
            }

            length += grapheme.length;
            totalGraphemeCount++;
        }

        if (length > 0) {
            preview.push(
                length === segment.text.length
                    ? segment
                    : {...segment, text: segment.text.slice(0, length)},
            );
        }

        if (isTruncated) {
            const remainingText = segment.text.slice(length);
            if (remainingText.length > 0) {
                newBodyMatch.push({...segment, text: remainingText});
            }

            segmentIndex++;
            break;
        }

        segmentIndex++;
    }

    // Add remaining segments to newBodyMatch
    for (let i = segmentIndex; i < bodyMatch.length; i++) {
        newBodyMatch.push(bodyMatch[i]!);
    }

    return {preview, newBodyMatch};
}

function getMissingSearchEntityTitleForMessage(
    type: ApiSearchMessageResultResponse["type"],
): string {
    // The "Unknown" prefix matches `missingSearchEntityTitle` in `shared/search`. We
    // don't import it to keep this package's first-party dependency list small (see
    // the comment in this package's `BUILD` file).
    switch (type) {
        case "ChatMessage":
            return "Unknown chat message";
        case "DocumentMessage":
            return "Unknown document comment";
        case "PostMessage":
            return "Unknown post comment";
        case "TaskMessage":
            return "Unknown task comment";
        default:
            throw exhaustive(type);
    }
}
