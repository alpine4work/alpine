import {splitGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";

/**
 * Function that'll truncate document titles for notification messages. Since
 * document titles can get quite long and we won't want to include the full title
 * in a notification.
 */
export function truncateDocumentTitleForNotification(string: string) {
    const maxGraphemeCount = 50;
    const graphemes = splitGraphemes(string);

    if (graphemes.length < maxGraphemeCount) return string;

    return `${graphemes.slice(0, maxGraphemeCount).join("").trim()}…`;
}
