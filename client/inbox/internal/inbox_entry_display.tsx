import {ReactNode} from "react";
import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {Box} from "~/client/design/box.js";
import {ChatBrandIcon} from "~/client/icons/brand/chat_brand_icon.js";
import {DocumentBrandIcon} from "~/client/icons/brand/document_brand_icon.js";
import {PostBrandIcon} from "~/client/icons/brand/post_brand_icon.js";
import {TaskBrandIcon} from "~/client/icons/brand/task_brand_icon.js";
import {sprinkles} from "~/client/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {printPrettyNumber} from "~/shared/design/print_pretty_number.js";
import {printPrettySmallNumberSummary} from "~/shared/design/print_pretty_small_number_summary.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Locale} from "~/shared/helpers/intl/locale.js";
import {
    InboxChannelPostsEntryModel,
    InboxChatEntryModel,
    InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
    InboxEntryModel,
    InboxPostCommentsEntryModel,
    InboxTaskEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {truncateDocumentTitleForNotification} from "~/shared/notifications/truncate_document_title_for_notification.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

/**
 * We create display objects for `InboxEntryModel`s which contains the shared
 * properties for displaying an inbox entry in an `<InboxEntryView>`.
 *
 * ## Style guide
 *
 * The following is a style guide you should follow when designing the display
 * for an inbox entry. We've put thought into how we can effectively
 * communicate a notification to the user in only a couple words. Such that the
 * user has enough preliminary information to make a decision on which
 * notifications to prioritize. We've written down that thinking in this style
 * guide.
 *
 * Following this style guide also makes sure inbox entry displays are
 * consistent across different entity types. So even in a full inbox there’s
 * order and harmony.
 *
 * ### The summary is ordered "what" or "how" then optionally "who"
 *
 * Most inbox entry summaries can be thought of in three parts what, how, and
 * who. You should order these parts as either:
 *
 * 1. What
 * 2. How
 * 3. Who
 *
 * or...
 *
 * 1. How
 * 2. What
 * 3. Who
 *
 * Whether "what" or "how" comes first is to be decided on a case-by-case
 * basis.
 *
 * To find the "what", "how", then "who" of any inbox entry ask yourself:
 *
 * - What is the object that changed?
 * - How was the object changed?
 * - Who made the change?
 *
 * For example, let's say Alice comments on Bob's post. In this scenario the
 * what/how/who is:
 *
 * - What: Bob's post
 * - How: New comment
 * - Who: Alice
 *
 * Bob's post (what) changed by receiving a comment (how) from Alice (who).
 *
 * Using the what, how, and who you could phrase an inbox entry summary a
 * couple of ways. Thank about how each of these summaries order the what, how,
 * and who:
 *
 * 1. Alice commented on Bob's post (who → how → what)
 * 2. New comments on Bob's post by Alice (how → what → who)
 * 3. Bob's post has a new comment from Alice (what → how → who)
 * 4. Bob's post has new comments (what → how)
 *
 * 2, 3, and 4 follows our style guide suggestion of "what" or "how" then
 * optionally "who". We prefer 3 and 4 since in this case the "how" will always
 * be "new comments" which doesn't give the user much information.
 *
 * Another example. Let's say 3 posts are created in the channel "Engineering
 * Help" by Alice, Bob, and Carol. The what/how/who for this inbox entry is:
 *
 * - What: Engineering Help channel
 * - How: 3 new posts
 * - Who: Alice, Bob, and Carol
 *
 * Two example summary phrasings could be:
 *
 * 1. Engineering Help has 3 new posts by Alice, Bob, and Carol (what → how → who)
 * 2. 3 new posts in Engineering Help by Alice, Bob, and Carol (how → what → who)
 *
 * We've chosen 2 for this notification because the number of posts (the "how")
 * best prepares users for what they'll see when they open the notification.
 * The "what" could also be long so putting the post count first improves
 * skimmability.
 *
 * **Why?** The "who" of an inbox entry is prominently featured outside of the
 * inbox entry's summary. It's featured in the account avatars displayed on the
 * left of the inbox entry and it's displayed in the latest message snippet
 * below the summary. So we want to focus on other pertinent information in the
 * inbox entry summary.
 *
 * Generally, since the "who" is displayed outside an inbox entry's summary, we
 * recommend omitting the "who" from the inbox entry summary entirely! So we
 * get shorter summaries.
 *
 * Also, since we batch many notification events into one inbox entry there
 * might be many "who"s for one inbox entry. For example, if Alice and Carol
 * both leave comments on Bob's post both Alice and Carol are "who"s in the
 * inbox entry. For inbox entry avatars we display the last two accounts to
 * make a change and in the inbox entry latest message snippet we name the
 * latest account to make a change. Listing 4+ accounts in an inbox entry may
 * make it harder to quickly interpret.
 *
 * ### If our account is mentioned ignore previous recommendations and put
 * "who" first in the summary
 *
 * If our account is mentioned then ignore our previous what/how/who ordering
 * and instead order the inbox entry summary who, how, then what. For example
 * if Alice mentions Bob in a comment then the summary for Bob should be:
 * “Alice mentioned you in your post”. If Carol is also subscribed to Bob's
 * post then Carol would get the standard what/how/who summary: “Bob's post has
 * a new comment from Alice” or “Bob’s post has new comments”.
 *
 * Always try to use the exact language “`${accountName}` mentioned you” at the
 * start of the summary for consistency.
 *
 * **Why?** If someone mentions you they’re explicitly trying to get your
 * attention. We're already grabbing the recipients attention with a loud
 * notification badge, we should immediately explain why there’s a loud
 * notification badge by describing that there’s a mention.
 *
 * Your social connection to the person mentioning you is often the most
 * important piece for interpreting the mention. Especially since often you'll
 * be mentioned on a piece of content you haven't seen before as someone is
 * trying to bring you into a conversation. For example a Product Manager
 * mentioning their Engineering Lead counterpart on a design specification.
 * Being able to quickly interpret the purpose of a mention through your social
 * connection to the mentioner is why we put the mentioner first.
 *
 * ### Don't use the comment brand icon variant
 *
 * For products that have a comment brand icon (e.g. `<TaskCommentBrandIcon>`,
 * `<DocumentCommentBrandIcon>`, and `<PostCommentBrandIcon>`) don't use them
 * for the inbox entry brand icon. Instead use the main product brand icon:
 *
 * - `<TaskCommentBrandIcon>` → `<TaskBrandIcon>`
 * - `<DocumentCommentBrandIcon>` → `<DocumentBrandIcon>`
 * - `<PostCommentBrandIcon>` → `<PostBrandIcon>`
 * - etc.
 *
 * We use the comment brand icons in search.
 *
 * **Why?** Most inbox entries are communication related (comments, messages,
 * posts). The purpose of brand icons on inbox entries is to help the user
 * interpret at a glance the content of each inbox entry. However, if a
 * majority of inbox entry brand icons include the comment symbol it makes it
 * harder to differentiate inbox entries.
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
    accountRegistry: AccountRegistry,
    summary: InboxEntryDisplaySummary,
): Store<string> {
    return computeStore(get => {
        let text = "";

        for (const summaryItem of summary) {
            if (typeof summaryItem === "string") {
                text += summaryItem;
            } else {
                text += getAccountShortNameWithoutFullNameTooltip(
                    get(accountRegistry.getAccountStore(summaryItem)),
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
    locale: Locale;
    currentAccount: AccountModel | null;
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
        case "Task":
            return getInboxTaskEntryDisplay({entry, currentAccount});
        default:
            throw exhaustive(entry);
    }
}

function getInboxChatEntryDisplay({
    entry,
    locale,
    currentAccount,
}: {
    entry: InboxChatEntryModel;
    locale: Locale;
    currentAccount: AccountModel | null;
}): InboxEntryDisplay {
    const firstAccount = entry.otherChatAccount ?? entry.latestMessage.author;

    const secondAccount =
        entry.latestMessage.author.id !== firstAccount.id ? entry.latestMessage.author : null;

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    if (entry.latestMessage.clerical?.type === "ShareNotification") {
        // If this was a clerical share notification then override the
        // notification summary to directly describe what happened.
        summary.push(entry.latestMessage.author);
        summary.push(
            ` shared a ${getFileEntityNoun(entry.latestMessage.clerical.entityType)} with you`,
        );
    } else if (entry.latestMessage.isStickyMention && entry.chatAccountCount > 2) {
        summary.push(entry.latestMessage.author);
        summary.push(" mentioned you in a chat with ");

        if (entry.chatAccountCount === 3 && entry.otherChatAccount) {
            summary.push(entry.otherChatAccount);
        } else if (!entry.otherChatAccount) {
            summary.push(printPrettyNumber(locale, entry.chatAccountCount - 2, "other"));
        } else {
            summary.push(entry.otherChatAccount);
            summary.push(" and ");
            summary.push(printPrettyNumber(locale, entry.chatAccountCount - 3, "other"));
        }
    } else if (entry.latestMessage.author.id !== currentAccount?.id) {
        // NOTE(calebmer): Chat message summaries are an exception to the inbox entry
        // display style guide since the summary is ordered who/what instead of
        // what/how.
        //
        // “Alice (who) sent you a message (how)” (who/how) vs “Your chat with Alice
        // (what) has new messages (how)” (what/how).
        //
        // Chat messages are an exception since the who/how ordering just sounds so
        // much more natural. Also since chats are identified by its members the who
        // and what are often the same. Also since all messages in a chat are loud
        // notifications it also makes sense to borrow the structure of mention inbox
        // summaries.

        summary.push(entry.latestMessage.author);
        summary.push(" sent you");

        if (entry.chatAccountCount === 3 && entry.otherChatAccount) {
            summary.push(" and ");
            summary.push(entry.otherChatAccount);
        } else if (entry.chatAccountCount > 2) {
            if (!entry.otherChatAccount) {
                summary.push(" and ");
                summary.push(printPrettyNumber(locale, entry.chatAccountCount - 2, "other"));
            } else {
                summary.push(", ");
                summary.push(entry.otherChatAccount);
                summary.push(", and ");
                summary.push(printPrettyNumber(locale, entry.chatAccountCount - 3, "other"));
            }
        }

        summary.push(" a message");
    } else {
        summary.push("You sent a message to ");

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
    currentAccount: AccountModel | null;
}): InboxEntryDisplay {
    const firstAccount: AccountModel =
        entry.postAuthor.id !== currentAccount?.id
            ? entry.postAuthor
            : entry.otherCommentAuthor ?? entry.latestComment?.author ?? entry.postAuthor;

    const secondAccount: AccountModel | null =
        entry.latestComment?.author.id !== firstAccount.id
            ? entry.latestComment?.author ?? null
            : null;

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    if (entry.postContentTextSnippetIfMentioned !== null) {
        summary.push(entry.postAuthor);
        summary.push(
            ` mentioned you in a post in ${
                entry.channel.isPrivate ? "a private channel" : entry.channel.channel.name
            }`,
        );
    } else if (entry.latestComment?.isStickyMention) {
        summary.push(entry.latestComment.author);
        summary.push(" mentioned you in a comment on ");

        if (currentAccount?.id === entry.postAuthor.id) {
            summary.push("your");
        } else if (entry.latestComment.author.id === entry.postAuthor.id) {
            summary.push("their");
        } else {
            summary.push(entry.postAuthor);
            summary.push("’s");
        }

        summary.push(
            ` post in ${
                entry.channel.isPrivate ? "a private channel" : entry.channel.channel.name
            }`,
        );
    } else {
        if (currentAccount?.id === entry.postAuthor.id) {
            summary.push("Your");
        } else {
            summary.push(entry.postAuthor);
            summary.push("’s");
        }

        summary.push(
            ` post in ${
                entry.channel.isPrivate ? "a private channel" : entry.channel.channel.name
            } has new comments`,
        );
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
    locale: Locale;
}): InboxEntryDisplay {
    const firstAccount: AccountModel = entry.otherPostAuthor ?? entry.latestPost.author;

    const secondAccount: AccountModel | null =
        entry.latestPost.author.id !== firstAccount.id ? entry.latestPost.author : null;

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    summary.push(printPrettySmallNumberSummary(entry.postCount, "new post"));
    summary.push(
        ` in ${entry.channel.isPrivate ? "a private channel" : entry.channel.channel.name} by `,
    );

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
    currentAccount: AccountModel | null;
}): InboxEntryDisplay {
    const firstAccount: AccountModel =
        entry.firstCommentAuthor.id !== currentAccount?.id
            ? entry.firstCommentAuthor
            : entry.otherCommentAuthor ?? entry.latestComment.author;

    const secondAccount: AccountModel | null =
        entry.latestComment?.author.id !== firstAccount.id
            ? entry.latestComment?.author ?? null
            : null;

    const documentTitle = entry.document.isPrivate
        ? "a private document"
        : `“${truncateDocumentTitleForNotification(entry.document.document.getTitle())}”`;

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    if (entry.latestComment.isStickyMention) {
        summary.push(entry.latestComment.author);
        summary.push(" mentioned you in ");

        if (currentAccount?.id === entry.firstCommentAuthor.id) {
            summary.push("your");
        } else if (entry.latestComment.author.id === entry.firstCommentAuthor.id) {
            summary.push("their");
        } else {
            summary.push(entry.firstCommentAuthor);
            summary.push("’s");
        }

        summary.push(` comment thread on ${documentTitle}`);
    } else {
        if (currentAccount?.id === entry.firstCommentAuthor.id) {
            summary.push("Your");
        } else {
            summary.push(entry.firstCommentAuthor);
            summary.push("’s");
        }

        summary.push(` thread on ${documentTitle} has new comments`);
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
    locale: Locale;
}): InboxEntryDisplay {
    const firstAccount: AccountModel = entry.otherCommentThreadAuthor ?? entry.firstComment.author;

    const secondAccount: AccountModel | null =
        entry.firstComment.author.id !== firstAccount.id ? entry.firstComment.author : null;

    const documentTitle = entry.document.isPrivate
        ? "a private document"
        : `“${truncateDocumentTitleForNotification(entry.document.document.getTitle())}”`;

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    summary.push(printPrettySmallNumberSummary(entry.commentThreadCount, "new comment thread"));
    summary.push(` on ${documentTitle} by `);

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

function getInboxTaskEntryDisplay({
    entry,
    currentAccount,
}: {
    entry: InboxTaskEntryModel;
    currentAccount: AccountModel | null;
}): InboxEntryDisplay {
    const firstAccount =
        entry.otherCommentAuthor ??
        entry.latestComment?.author ??
        (!entry.task.isPrivate ? entry.task.taskOwner : null);

    const secondAccount =
        entry.latestComment?.author.id !== firstAccount.id
            ? entry.latestComment?.author ?? null
            : null;

    const summary: Array<InboxEntryDisplaySummaryItem> = [];

    if (entry.latestComment?.isStickyMention) {
        summary.push(entry.latestComment.author);
        summary.push(" mentioned you in a comment on ");

        if (entry.task.isPrivate) {
            summary.push(" a private task");
        } else {
            if (currentAccount?.id === entry.task.taskOwner.id) {
                summary.push("your");
            } else if (entry.latestComment.author.id === entry.task.taskOwner.id) {
                summary.push("their");
            } else {
                summary.push(entry.task.taskOwner);
                summary.push("’s");
            }

            summary.push(" task");
        }
    } else {
        if (entry.task.isPrivate) {
            summary.push("A private task");
        } else {
            if (currentAccount?.id === entry.task.taskOwner.id) {
                summary.push("Your");
            } else {
                summary.push(entry.task.taskOwner);
                summary.push("’s");
            }

            summary.push(" task");
        }

        summary.push(" has new comments");
    }

    return {
        time: entry.latestComment.createdTime,
        brandIcon: <TaskBrandIcon />,
        firstAccount,
        secondAccount,
        latestMessage: entry.latestComment,
        summary,
    };
}
