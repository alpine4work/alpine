import GraphemeSplitter from "grapheme-splitter";

/**
 * Function that'll truncate document titles for notification messages. Since
 * document titles can get quite long and we won't want to include the full
 * title in a notification.
 */
export function truncateDocumentTitleForNotification(string: string) {
    const splitter = new GraphemeSplitter();

    const maxGraphemeCount = 50;
    const graphemes = splitter.splitGraphemes(string);

    if (graphemes.length < maxGraphemeCount) return string;

    return `${graphemes.slice(0, maxGraphemeCount).join("").trim()}…`;
}
