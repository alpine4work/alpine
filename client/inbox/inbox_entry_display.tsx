import GraphemeSplitter from "grapheme-splitter";
import {ReactNode} from "react";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {printPrettyNumber, printPrettySmallNumberSummary} from "~/client/design/pretty_number.js";
import {computeStore} from "~/client/helpers/store/compute_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {ChatBrandIcon} from "~/client/icons/brand/chat_brand_icon.js";
import {DocumentBrandIcon} from "~/client/icons/brand/document_brand_icon.js";
import {PostBrandIcon} from "~/client/icons/brand/post_brand_icon.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    InboxChannelPostsEntryModel,
    InboxChatEntryModel,
    InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
    InboxEntryModel,
    InboxPostCommentsEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {sprinkles} from "~/shared/styles/styles.js";

/**
 * We create display objects for `InboxEntryModel`s which contains the shared
 * properties for displaying an inbox entry in an `<InboxEntryView>`.
 */
export type InboxEntryDisplay = {
    readonly time: Date;
    readonly brandIcon: ReactNode;
    readonly firstAccount: AccountModel;
    readonly secondAccount: AccountModel | null;
    readonly latestMessage: {
        readonly author: AccountModel;
        readonly contentTextSnippet: string;
    } | null;
    readonly summary: InboxEntryDisplaySummary;
};

/**
 * The summary text of an inbox entry with some rich text or interactive
 * elements. Can be rendered to non-interactive plain text as well if needed.
 */
export type InboxEntryDisplaySummary = ReadonlyArray<InboxEntryDisplaySummaryItem>;

export type InboxEntryDisplaySummaryItem =
    | string
    // Rendered in bold with `<AccountShortName>`
    | AccountModel;

/**
 * Render `InboxEntryDisplaySummary` to interactive React DOM nodes.
 */
export function renderInboxEntryDisplaySummary(summary: InboxEntryDisplaySummary): ReactNode {
    const boldClassName = sprinkles({
        fontStyle: "bold",
    });

    return summary.map((summaryItem, i) => {
        if (typeof summaryItem === "string") {
            return summaryItem;
        } else {
            return (
                <span key={i} className={boldClassName}>
                    <AccountShortName account={summaryItem} />
                </span>
            );
        }
    });
}

/**
 * Print `InboxEntryDisplaySummary` to a plain text string without any
 * interactivity or embellishment (e.g. account names are not in bold).
 */
export function printInboxEntryDisplaySummaryWithoutInteractivityStore(
    accountStore: AccountClientStore,
    summary: InboxEntryDisplaySummary,
): Store<string> {
    return computeStore(get => {
        let text = "";

        for (const summaryItem of summary) {
            if (typeof summaryItem === "string") {
                text += summaryItem;
            } else {
                text += getAccountShortNameWithoutFullNameTooltip(
                    get(accountStore.getAccountStore(summaryItem)),
                );
            }
        }

        return text;
    });
}

export function getInboxEntryDisplay({
    entry,
    locale,
    currentAccount,
}: {
    entry: InboxEntryModel;
    locale: string;
    currentAccount: AccountModel;
}): InboxEntryDisplay {
    switch (entry.type) {
        case "Chat":
            return getInboxChatEntryDisplay({entry, locale, currentAccount});
        case "PostComments":
            return getInboxPostCommentsEntryDisplay({entry, currentAccount});
        case "ChannelPosts":
            return getInboxChannelPostsEntryDisplay({entry, locale});
        case "DocumentCommentThread":
            return getInboxDocumentCommentThreadEntryDisplay({entry, currentAccount});
        case "DocumentNewCommentThreads":
            return getInboxDocumentNewCommentThreadsEntryDisplay({entry, locale});
        default:
            console.log(entry);
            throw exhaustive(entry);
    }
}

function getInboxChatEntryDisplay({
    entry,
    locale,
    currentAccount,
}: {
    entry: InboxChatEntryModel;
    locale: string;
    currentAccount: AccountModel;
}): InboxEntryDisplay {
    const firstAccount = entry.otherChatAccount ?? entry.latestMessage.author;

    const secondAccount =
        entry.latestMessage.author.id !== firstAccount.id ? entry.latestMessage.author : null;

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    if (entry.latestMessage.isStickyMention && entry.chatAccountCount > 2) {
        summary.push(entry.latestMessage.author);
        summary.push(" mentioned you in a chat with ");

        if (entry.chatAccountCount === 3 && entry.otherChatAccount) {
            summary.push(entry.otherChatAccount);
        } else {
            summary.push(printPrettyNumber(locale, entry.chatAccountCount - 2, "other"));
        }
    } else if (entry.latestMessage.author.id !== currentAccount.id) {
        summary.push(entry.latestMessage.author);
        summary.push(" sent you");

        if (entry.chatAccountCount === 3 && entry.otherChatAccount) {
            summary.push(" and ");
            summary.push(entry.otherChatAccount);
        } else if (entry.chatAccountCount > 2) {
            summary.push(" and ");
            summary.push(printPrettyNumber(locale, entry.chatAccountCount - 2, "other"));
        }

        summary.push(" a chat message");
    } else {
        summary.push("You sent a chat message to ");

        if (entry.chatAccountCount === 1) {
            summary.push("yourself");
        } else if (entry.chatAccountCount === 2 && entry.otherChatAccount) {
            summary.push(entry.otherChatAccount);
        } else if (entry.otherChatAccount) {
            summary.push(entry.otherChatAccount);
            summary.push(" and ");
            summary.push(printPrettyNumber(locale, entry.chatAccountCount - 2, "other"));
        } else {
            summary.push(printPrettyNumber(locale, entry.chatAccountCount - 1, "other"));
        }
    }

    return {
        time: entry.latestMessage.createdTime,
        brandIcon: <ChatBrandIcon />,
        firstAccount: firstAccount,
        secondAccount: secondAccount,
        latestMessage: entry.latestMessage,
        summary,
    };
}

function getInboxPostCommentsEntryDisplay({
    entry,
    currentAccount,
}: {
    entry: InboxPostCommentsEntryModel;
    currentAccount: AccountModel;
}): InboxEntryDisplay {
    const firstAccount: AccountModel =
        entry.postAuthor.id !== currentAccount.id
            ? entry.postAuthor
            : entry.otherCommentAuthor ?? entry.latestComment?.author ?? entry.postAuthor;

    const secondAccount: AccountModel | null =
        entry.latestComment?.author.id !== firstAccount.id
            ? entry.latestComment?.author ?? null
            : null;

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    if (entry.postContentTextSnippetIfMentioned !== null) {
        summary.push(entry.postAuthor);
        summary.push(` mentioned you in a post in ${entry.channel.name}`);
    } else if (entry.latestComment?.isStickyMention) {
        summary.push(entry.latestComment.author);
        summary.push(" mentioned you in a comment on ");

        if (currentAccount.id === entry.postAuthor.id) {
            summary.push("your");
        } else if (entry.latestComment.author.id === entry.postAuthor.id) {
            summary.push("their");
        } else {
            summary.push(entry.postAuthor);
            summary.push("’s");
        }

        summary.push(` post in ${entry.channel.name}`);
    } else {
        if (currentAccount.id === entry.postAuthor.id) {
            summary.push("Your");
        } else {
            summary.push(entry.postAuthor);
            summary.push("’s");
        }

        summary.push(` post in ${entry.channel.name} has new comments`);
    }

    return {
        time: entry.latestComment?.createdTime ?? entry.postCreatedTime,
        brandIcon: <PostBrandIcon />,
        firstAccount: firstAccount,
        secondAccount: secondAccount,
        latestMessage:
            entry.postContentTextSnippetIfMentioned !== null
                ? {
                      author: entry.postAuthor,
                      contentTextSnippet: entry.postContentTextSnippetIfMentioned,
                  }
                : entry.latestComment,
        summary,
    };
}

function getInboxChannelPostsEntryDisplay({
    entry,
    locale,
}: {
    entry: InboxChannelPostsEntryModel;
    locale: string;
}): InboxEntryDisplay {
    const firstAccount: AccountModel = entry.otherPostAuthor ?? entry.latestPost.author;

    const secondAccount: AccountModel | null =
        entry.latestPost.author.id !== firstAccount.id ? entry.latestPost.author : null;

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    summary.push(printPrettySmallNumberSummary(entry.postCount, "new post"));
    summary.push(` in ${entry.channel.name} by `);

    if (!secondAccount) {
        summary.push(firstAccount);
    } else if (entry.postAuthorCount <= 2) {
        summary.push(secondAccount);
        summary.push(" and ");
        summary.push(firstAccount);
    } else {
        summary.push(secondAccount);
        summary.push(", ");
        summary.push(firstAccount);
        summary.push(", and ");
        summary.push(printPrettyNumber(locale, entry.postAuthorCount - 2, "other"));
    }

    return {
        time: entry.latestPost.createdTime,
        brandIcon: <PostBrandIcon />,
        firstAccount: firstAccount,
        secondAccount: secondAccount,
        latestMessage: entry.latestPost,
        summary,
    };
}

function getInboxDocumentCommentThreadEntryDisplay({
    entry,
    currentAccount,
}: {
    entry: InboxDocumentCommentThreadEntryModel;
    currentAccount: AccountModel;
}): InboxEntryDisplay {
    const firstAccount: AccountModel =
        entry.firstCommentAuthor.id !== currentAccount.id
            ? entry.firstCommentAuthor
            : entry.otherCommentAuthor ?? entry.latestComment.author;

    const secondAccount: AccountModel | null =
        entry.latestComment?.author.id !== firstAccount.id
            ? entry.latestComment?.author ?? null
            : null;

    const truncatedDocumentTitle = truncateDocumentTitle(entry.document.getTitle());

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    if (entry.latestComment.isStickyMention) {
        summary.push(entry.latestComment.author);
        summary.push(" mentioned you in ");

        if (currentAccount.id === entry.firstCommentAuthor.id) {
            summary.push("your");
        } else if (entry.latestComment.author.id === entry.firstCommentAuthor.id) {
            summary.push("their");
        } else {
            summary.push(entry.firstCommentAuthor);
            summary.push("’s");
        }

        summary.push(` comment thread on “${truncatedDocumentTitle}”`);
    } else {
        if (currentAccount.id === entry.firstCommentAuthor.id) {
            summary.push("Your");
        } else {
            summary.push(entry.firstCommentAuthor);
            summary.push("’s");
        }

        summary.push(` thread on “${truncatedDocumentTitle}” has new comments`);
    }

    return {
        time: entry.latestComment.createdTime,
        brandIcon: (
            // Scooch document icon right a little to balance it visually with other icons.
            // Given the document icon has a vertical orientation vs horizontal
            // orientation.
            <Box position="relative" style={{right: "-0.0625rem"}}>
                <DocumentBrandIcon />
            </Box>
        ),
        firstAccount: firstAccount,
        secondAccount: secondAccount,
        latestMessage: entry.latestComment,
        summary,
    };
}

function getInboxDocumentNewCommentThreadsEntryDisplay({
    entry,
    locale,
}: {
    entry: InboxDocumentNewCommentThreadsEntryModel;
    locale: string;
}): InboxEntryDisplay {
    const firstAccount: AccountModel = entry.otherCommentThreadAuthor ?? entry.firstComment.author;

    const secondAccount: AccountModel | null =
        entry.firstComment.author.id !== firstAccount.id ? entry.firstComment.author : null;

    const truncatedDocumentTitle = truncateDocumentTitle(entry.document.getTitle());

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    summary.push(printPrettySmallNumberSummary(entry.commentThreadCount, "new comment thread"));
    summary.push(` on “${truncatedDocumentTitle}” by `);

    if (!secondAccount) {
        summary.push(firstAccount);
    } else if (entry.commentThreadAuthorCount <= 2) {
        summary.push(secondAccount);
        summary.push(" and ");
        summary.push(firstAccount);
    } else {
        summary.push(secondAccount);
        summary.push(", ");
        summary.push(firstAccount);
        summary.push(", and ");
        summary.push(printPrettyNumber(locale, entry.commentThreadAuthorCount - 2, "other"));
    }

    return {
        time: entry.firstComment.createdTime,
        brandIcon: (
            // Scooch document icon right a little to balance it visually with other icons.
            // Given the document icon has a vertical orientation vs horizontal
            // orientation.
            <Box position="relative" style={{right: "-0.0625rem"}}>
                <DocumentBrandIcon />
            </Box>
        ),
        firstAccount: firstAccount,
        secondAccount: secondAccount,
        latestMessage: entry.firstComment,
        summary,
    };
}

function truncateDocumentTitle(string: string) {
    const splitter = new GraphemeSplitter();

    const maxGraphemeCount = 50;
    const graphemes = splitter.splitGraphemes(string);

    if (graphemes.length < maxGraphemeCount) return string;

    return `${graphemes.slice(0, maxGraphemeCount).join("").trim()}…`;
}
