import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {
    ApiInboxEntry,
    ApiInboxEntryShared,
    ApiInboxEntryTitleItem,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {
    InboxEntryDisplayContent,
    InboxEntryDisplayContentTitle,
    getInboxEntryDisplayContent,
} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";

export function intoApiInboxEntry(entry: InboxEntryModel): ApiInboxEntry {
    const display = getInboxEntryDisplayContent({
        entry,
        locale: defaultLocale,
        currentAccount: null,
    });

    return {
        title: intoApiInboxEntryTitle(display.title),
        preview: intoApiInboxEntryPreview(display),
        time: serializeDateString(display.time),
        loudNotificationCount: entry.loudNotificationCount,
        status: entry.isArchived ? "Done" : "New",
        featured: {
            type: "Account",
            account: intoApiAccount(display.featuredAccount.initialData),
        },
        otherAccount: display.otherAccount
            ? intoApiAccount(display.otherAccount.initialData)
            : undefined,
        ...getDiscriminantProperties(entry),
    };
}

function intoApiInboxEntryTitle(
    title: InboxEntryDisplayContentTitle,
): ReadonlyArray<ApiInboxEntryTitleItem> {
    return title.map(item =>
        typeof item === "string"
            ? {type: "Text", text: item}
            : {type: "Account", account: intoApiAccount(item.initialData)},
    );
}

/**
 * Build the preview text for an inbox entry, prefixed with the latest message
 * author's short name (e.g. `Caleb: Blah blah blah`). This mirrors how the inbox
 * entry renders in the product. If callers need the author and content as separate
 * values, they can read `featuredAccount`/`otherAccount` and `previewMessage` on
 * the entry.
 */
function intoApiInboxEntryPreview(display: InboxEntryDisplayContent): string | undefined {
    if (!display.latestMessage || display.latestMessage.contentTextSnippet.length === 0) {
        return undefined;
    }

    const authorShortName = getAccountShortNameWithoutFullNameTooltip(
        display.latestMessage.author.initialData,
    );
    return `${authorShortName}: ${display.latestMessage.contentTextSnippet}`;
}

function getDiscriminantProperties(
    entry: InboxEntryModel,
): DistributiveOmit<ApiInboxEntry, keyof ApiInboxEntryShared> {
    switch (entry.type) {
        case "Chat":
            return {
                type: "Chat",
                chat: {id: entry.chatId},
                previewMessage: {index: entry.latestMessage.index},
            };
        case "PostComments":
            return {
                type: "Post",
                post: {id: entry.postId},
                previewMessage: entry.latestComment
                    ? {index: entry.latestComment.index}
                    : undefined,
            };
        case "ChannelPosts":
            return {
                type: "CreatedChannelPosts",
                channel: {id: entry.getChannelId()},
                posts: Array.from(entry.postIds, id => ({id})),
            };
        case "DocumentCommentThread":
            return {
                type: "DocumentThread",
                thread: {
                    id: entry.commentThreadId,
                    document: {id: entry.getDocumentId()},
                },
                previewMessage: {index: entry.latestComment.index},
            };
        case "DocumentNewCommentThreads":
            return {
                type: "CreatedDocumentThreads",
                document: {id: entry.getDocumentId()},
                threads: Array.from(entry.commentThreadIds, id => ({id})),
            };
        case "Task":
            return {
                type: "TaskMessages",
                task: {id: entry.task.taskId},
                previewMessage: {index: entry.latestComment.index},
            };
        default:
            throw exhaustive(entry);
    }
}
