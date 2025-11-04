import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {maxReasonableEnglishWordGraphemeCount} from "~/shared/helpers/string/max_reasonable_english_word_grapheme_count.js";

export const contentMentionTextTruncatedSuffix = " […]";

export const contentMentionTextSoftMaxGraphemeCount = 130;

// According to Claude, 99% of English words are 14 characters or shorter. So
// we should safely be able to include an English word before we truncate.
export const contentMentionTextHardMaxGraphemeCount =
    contentMentionTextSoftMaxGraphemeCount + maxReasonableEnglishWordGraphemeCount;

export function truncateContentMentionText(string: string) {
    string = string.trim();

    let length = 0;
    let graphemeCount = 0;
    let isTruncated = false;

    for (const grapheme of iterateGraphemes(string)) {
        // Truncate after the hard break max grapheme count.
        if (graphemeCount >= contentMentionTextHardMaxGraphemeCount) {
            isTruncated = true;
            break;
        }

        // Break at the first whitespace we see after the soft max grapheme count.
        if (
            graphemeCount >= contentMentionTextSoftMaxGraphemeCount &&
            /^\p{White_Space}+$/u.test(grapheme)
        ) {
            isTruncated = true;
            break;
        }

        length += grapheme.length;
        graphemeCount++;
    }

    let truncatedString = string.slice(0, length);

    // Add the truncated suffix. Unless the string already ends with the
    // truncated suffix.
    if (isTruncated && !truncatedString.endsWith(contentMentionTextTruncatedSuffix))
        truncatedString += contentMentionTextTruncatedSuffix;

    return truncatedString;
}
