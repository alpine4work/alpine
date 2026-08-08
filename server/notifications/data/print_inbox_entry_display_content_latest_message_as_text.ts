import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {InboxEntryDisplayContent} from "~/shared/notifications/get_inbox_entry_display_content.js";

/**
 * Prints an inbox entry's latest message as an author-prefixed text preview.
 */
export function printInboxEntryDisplayContentLatestMessageAsText(
    display: InboxEntryDisplayContent,
    {excludeAuthorWhenPresentInTitle = false}: {excludeAuthorWhenPresentInTitle?: boolean} = {},
): string | undefined {
    if (!display.latestMessage || display.latestMessage.contentTextSnippet.length === 0) {
        return undefined;
    }

    if (
        excludeAuthorWhenPresentInTitle &&
        display.title.some(
            item => typeof item !== "string" && item.id === display.latestMessage?.author.id,
        )
    ) {
        return display.latestMessage.contentTextSnippet;
    }

    return `${getAccountShortNameWithoutFullNameTooltip(
        display.latestMessage.author.initialData,
    )}: ${display.latestMessage.contentTextSnippet}`;
}
