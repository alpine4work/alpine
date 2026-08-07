import {printPrettySmallNumberSummary} from "~/shared/design/print_pretty_small_number_summary.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Locale} from "~/shared/helpers/intl/locale.open_source.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.open_source.js";
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
import {
    AccountModel,
    AccountModelData,
    AccountModelDataWithoutAvatar,
} from "~/shared/spaces/account_model.js";

/**
 * We create display objects for `InboxEntryModel`s which contains the shared
 * properties for displaying an inbox entry in an `<InboxEntryView>`.
 *
 * ## Style guide
 *
 * The following is a style guide you should follow when designing the display for
 * an inbox entry. We've put thought into how we can effectively communicate a
 * notification to the user in only a couple words. Such that the user has enough
 * preliminary information to make a decision on which notifications to prioritize.
 * We've written down that thinking in this style guide.
 *
 * Following this style guide also makes sure inbox entry displays are consistent
 * across different entity types. So even in a full inbox there's order and
 * harmony.
 *
 * ### The title is ordered "what" or "how" then optionally "who"
 *
 * Most inbox entry titles can be thought of in three parts what, how, and who. You
 * should order these parts as either:
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
 * Whether "what" or "how" comes first is to be decided on a case-by-case basis.
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
 * Using the what, how, and who you could phrase an inbox entry title a couple of
 * ways. Thank about how each of these summaries order the what, how, and who:
 *
 * 1. Alice commented on Bob's post (who → how → what)
 * 2. New comments on Bob's post by Alice (how → what → who)
 * 3. Bob's post has a new comment from Alice (what → how → who)
 * 4. Bob's post has new comments (what → how)
 *
 * 2, 3, and 4 follows our style guide suggestion of "what" or "how" then
 * optionally "who". We prefer 3 and 4 since in this case the "how" will always be
 * "new comments" which doesn't give the user much information.
 *
 * Another example. Let's say 3 posts are created in the channel "Engineering Help"
 * by Alice, Bob, and Carol. The what/how/who for this inbox entry is:
 *
 * - What: Engineering Help channel
 * - How: 3 new posts
 * - Who: Alice, Bob, and Carol
 *
 * Two example title phrasings could be:
 *
 * 1. Engineering Help has 3 new posts by Alice, Bob, and Carol (what → how → who)
 * 2. 3 new posts in Engineering Help by Alice, Bob, and Carol (how → what → who)
 *
 * We've chosen 2 for this notification because the number of posts (the "how")
 * best prepares users for what they'll see when they open the notification. The
 * "what" could also be long so putting the post count first improves skimmability.
 *
 * **Why?** The "who" of an inbox entry is prominently featured outside of the
 * inbox entry's title. It's featured in the account avatars displayed on the left
 * of the inbox entry and it's displayed in the latest message snippet below the
 * title. So we want to focus on other pertinent information in the inbox entry
 * title.
 *
 * Generally, since the "who" is displayed outside an inbox entry's summary, we
 * recommend omitting the "who" from the inbox entry title entirely! So we get
 * shorter summaries.
 *
 * Also, since we batch many notification events into one inbox entry there might
 * be many "who"s for one inbox entry. For example, if Alice and Carol both leave
 * comments on Bob's post both Alice and Carol are "who"s in the inbox entry. For
 * inbox entry avatars we display the last two accounts to make a change and in the
 * inbox entry latest message snippet we name the latest account to make a change.
 * Listing 4+ accounts in an inbox entry may make it harder to quickly interpret.
 *
 * ### If our account is mentioned ignore previous recommendations and put
 *
 * "who" first in the title
 *
 * If our account is mentioned then ignore our previous what/how/who ordering and
 * instead order the inbox entry title who, how, then what. For example if Alice
 * mentions Bob in a comment then the title for Bob should be: "Alice mentioned you
 * in your post". If Carol is also subscribed to Bob's post then Carol would get
 * the standard what/how/who title: "Bob's post has a new comment from Alice" or
 * "Bob's post has new comments".
 *
 * Always try to use the exact language "`${accountName}` mentioned you" at the
 * start of the title for consistency.
 *
 * **Why?** If someone mentions you they're explicitly trying to get your
 * attention. We're already grabbing the recipients attention with a loud
 * notification badge, we should immediately explain why there's a loud
 * notification badge by describing that there's a mention.
 *
 * Your social connection to the person mentioning you is often the most important
 * piece for interpreting the mention. Especially since often you'll be mentioned
 * on a piece of content you haven't seen before as someone is trying to bring you
 * into a conversation. For example a Product Manager mentioning their Engineering
 * Lead counterpart on a design specification. Being able to quickly interpret the
 * purpose of a mention through your social connection to the mentioner is why we
 * put the mentioner first.
 *
 * ### Don't use the comment brand icon variant
 *
 * For products that have a comment brand icon (e.g. `<TaskCommentBrandIcon>`,
 * `<DocumentCommentBrandIcon>`, and `<PostCommentBrandIcon>`) don't use them for
 * the inbox entry brand icon. Instead use the main product brand icon:
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
 * interpret at a glance the content of each inbox entry. However, if a majority of
 * inbox entry brand icons include the comment symbol it makes it harder to
 * differentiate inbox entries.
 */
export type InboxEntryDisplayContent = {
    readonly time: Date;
    readonly brandIconType: "Chat" | "Task" | "Document" | "Post";
    readonly featuredAccount: AccountModel;
    readonly otherAccount: AccountModel | null;
    readonly latestMessage: {
        readonly author: AccountModel;
        readonly contentTextSnippet: string;
    } | null;
    readonly title: InboxEntryDisplayContentTitle;
};

/**
 * The title text of an inbox entry with some rich text or interactive elements.
 * This is the primary text displayed in the inbox entry. Can be rendered to
 * non-interactive plain text as well if needed.
 */
export type InboxEntryDisplayContentTitle = ReadonlyArray<InboxEntryDisplayContentTitleItem>;

export type InboxEntryDisplayContentTitleItem =
    | string
    // Rendered in bold with `<AccountShortName>`
    | AccountModel;

export function getInboxEntryDisplayContent({
    entry,
    locale,
    currentAccount,
}: {
    entry: InboxEntryModel;
    locale: Locale;
    currentAccount: AccountModel | AccountModelData | AccountModelDataWithoutAvatar | null;
}): InboxEntryDisplayContent {
    switch (entry.type) {
        case "Chat":
            return getInboxChatEntryDisplay({entry, locale, currentAccount});
        case "PostComments":
            return getInboxPostCommentsEntryDisplay({entry, locale, currentAccount});
        case "ChannelPosts":
            return getInboxChannelPostsEntryDisplay({entry, locale});
        case "DocumentCommentThread":
            return getInboxDocumentCommentThreadEntryDisplay({entry, locale, currentAccount});
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
    currentAccount: AccountModel | AccountModelData | AccountModelDataWithoutAvatar | null;
}): InboxEntryDisplayContent {
    const featuredAccount = entry.otherChatAccount ?? entry.latestMessage.author;

    const otherAccount =
        entry.latestMessage.author.id !== featuredAccount.id ? entry.latestMessage.author : null;

    const title: Array<InboxEntryDisplayContentTitleItem> = [];

    if (entry.latestMessage.clerical?.type === "ShareNotification") {
        // If this was a clerical share notification then override the notification title
        // to directly describe what happened.
        title.push(entry.latestMessage.author);
        title.push(
            ` shared a ${getFileEntityNoun(entry.latestMessage.clerical.entityType)} with you`,
        );
    } else if (entry.definition.type === "Room") {
        if (entry.latestMessage.isStickyMention) {
            title.push(entry.latestMessage.author);
            title.push(" mentioned you in ");
            if (entry.definition.isPrivate) {
                title.push("a private chat");
            } else {
                title.push(entry.definition.name);
            }
        } else if (entry.latestMessage.author.id !== currentAccount?.id) {
            title.push(entry.latestMessage.author);
            title.push(" sent a message in ");
            if (entry.definition.isPrivate) {
                title.push("a private chat");
            } else {
                title.push(entry.definition.name);
            }
        } else {
            title.push("You sent a message in ");
            if (entry.definition.isPrivate) {
                title.push("a private chat");
            } else {
                title.push(entry.definition.name);
            }
        }
    } else if (entry.latestMessage.isStickyMention && entry.definition.accountCount > 2) {
        title.push(entry.latestMessage.author);
        title.push(" mentioned you in a chat with ");

        if (entry.definition.accountCount === 3 && entry.otherChatAccount) {
            title.push(entry.otherChatAccount);
        } else if (!entry.otherChatAccount) {
            title.push(printPrettyNumber(locale, entry.definition.accountCount - 2, "other"));
        } else {
            title.push(entry.otherChatAccount);
            title.push(" and ");
            title.push(printPrettyNumber(locale, entry.definition.accountCount - 3, "other"));
        }
    } else if (entry.latestMessage.author.id !== currentAccount?.id) {
        // NOTE(calebmer): Chat message summaries are an exception to the inbox entry
        // display style guide since the summary is ordered who/what instead of what/how.
        //
        // "Alice (who) sent you a message (how)" (who/how) vs "Your chat with Alice (what)
        // has new messages (how)" (what/how).
        //
        // Chat messages are an exception since the who/how ordering just sounds so much
        // more natural. Also since chats are identified by its members the who and what
        // are often the same. Also since all messages in a chat are loud notifications it
        // also makes sense to borrow the structure of mention inbox summaries.

        title.push(entry.latestMessage.author);
        title.push(" sent you");

        if (entry.definition.accountCount === 3 && entry.otherChatAccount) {
            title.push(" and ");
            title.push(entry.otherChatAccount);
        } else if (entry.definition.accountCount > 2) {
            if (!entry.otherChatAccount) {
                title.push(" and ");
                title.push(printPrettyNumber(locale, entry.definition.accountCount - 2, "other"));
            } else {
                title.push(", ");
                title.push(entry.otherChatAccount);
                title.push(", and ");
                title.push(printPrettyNumber(locale, entry.definition.accountCount - 3, "other"));
            }
        }

        title.push(" a message");
    } else {
        title.push("You sent a message to ");

        if (entry.definition.accountCount === 1) {
            title.push("yourself");
        } else if (entry.definition.accountCount === 2 && entry.otherChatAccount) {
            title.push(entry.otherChatAccount);
        } else if (entry.otherChatAccount) {
            title.push(entry.otherChatAccount);
            title.push(" and ");
            title.push(printPrettyNumber(locale, entry.definition.accountCount - 2, "other"));
        } else {
            title.push(printPrettyNumber(locale, entry.definition.accountCount - 1, "other"));
        }
    }

    return {
        time: entry.latestMessage.createdTime,
        brandIconType: "Chat",
        featuredAccount: featuredAccount,
        otherAccount: otherAccount,
        latestMessage: entry.latestMessage,
        title,
    };
}

function getInboxPostCommentsEntryDisplay({
    entry,
    locale,
    currentAccount,
}: {
    entry: InboxPostCommentsEntryModel;
    locale: Locale;
    currentAccount: AccountModel | AccountModelData | AccountModelDataWithoutAvatar | null;
}): InboxEntryDisplayContent {
    const featuredAccount: AccountModel =
        entry.postAuthor.id !== currentAccount?.id
            ? entry.postAuthor
            : (entry.otherCommentAuthor ?? entry.latestComment?.author ?? entry.postAuthor);

    const otherAccount: AccountModel | null =
        entry.latestComment?.author.id !== featuredAccount.id
            ? (entry.latestComment?.author ?? null)
            : null;

    const title: Array<InboxEntryDisplayContentTitleItem> = [];

    if (entry.isForPostContentMention) {
        title.push(entry.postAuthor);
        title.push(
            ` mentioned you in a post in ${
                entry.channel.isPrivate ? "a private channel" : entry.channel.channel.name
            }`,
        );
    } else if (!entry.latestComment) {
        // When we archive a post in `ChannelPostsEntry` we create an archived
        // `PostCommentsEntry` with no `latestComment`. Render this `PostCommentsEntry` the
        // same as a `ChannelPostsEntry` with one post.
        return getInboxChannelPostsEntryDisplay({
            locale,
            entry: {
                channel: entry.channel,
                postIds: new Set([entry.postId]),
                postAuthorCount: 1,
                latestPost: {
                    id: entry.postId,
                    author: entry.postAuthor,
                    createdTime: entry.postCreatedTime,
                    contentTextSnippet: entry.postContentTextSnippet ?? "",
                },
                otherPostAuthor: null,
            },
        });
    } else if (entry.latestComment.isStickyMention) {
        title.push(entry.latestComment.author);
        title.push(" mentioned you in a comment on ");

        if (currentAccount?.id === entry.postAuthor.id) {
            title.push("your");
        } else if (entry.latestComment.author.id === entry.postAuthor.id) {
            title.push("their");
        } else {
            title.push(entry.postAuthor);
            title.push("\u2019s");
        }

        title.push(
            ` post in ${
                entry.channel.isPrivate ? "a private channel" : entry.channel.channel.name
            }`,
        );
    } else {
        if (currentAccount?.id === entry.postAuthor.id) {
            title.push("Your");
        } else {
            title.push(entry.postAuthor);
            title.push("\u2019s");
        }

        title.push(
            ` post in ${
                entry.channel.isPrivate ? "a private channel" : entry.channel.channel.name
            } has new comments`,
        );
    }

    return {
        time: entry.latestComment?.createdTime ?? entry.postCreatedTime,
        brandIconType: "Post",
        featuredAccount: featuredAccount,
        otherAccount: otherAccount,
        latestMessage: entry.isForPostContentMention
            ? {
                  author: entry.postAuthor,
                  contentTextSnippet: entry.postContentTextSnippet ?? "",
              }
            : entry.latestComment,
        title,
    };
}

function getInboxChannelPostsEntryDisplay({
    entry,
    locale,
}: {
    entry: Pick<
        InboxChannelPostsEntryModel,
        "postIds" | "postAuthorCount" | "latestPost" | "otherPostAuthor"
    > & {
        channel: {isPrivate: true} | {isPrivate: false; channel: ChannelPreviewModel};
    };
    locale: Locale;
}): InboxEntryDisplayContent {
    const featuredAccount: AccountModel = entry.otherPostAuthor ?? entry.latestPost.author;

    const otherAccount: AccountModel | null =
        entry.latestPost.author.id !== featuredAccount.id ? entry.latestPost.author : null;

    const title: Array<InboxEntryDisplayContentTitleItem> = [];

    title.push(printPrettySmallNumberSummary(entry.postIds.size, "new post"));
    title.push(
        ` in ${entry.channel.isPrivate ? "a private channel" : entry.channel.channel.name} by `,
    );

    if (!otherAccount) {
        title.push(featuredAccount);
    } else if (entry.postAuthorCount <= 2) {
        title.push(otherAccount);
        title.push(" and ");
        title.push(featuredAccount);
    } else {
        title.push(otherAccount);
        title.push(", ");
        title.push(featuredAccount);
        title.push(", and ");
        title.push(printPrettyNumber(locale, entry.postAuthorCount - 2, "other"));
    }

    return {
        time: entry.latestPost.createdTime,
        brandIconType: "Post",
        featuredAccount: featuredAccount,
        otherAccount: otherAccount,
        latestMessage: entry.latestPost,
        title,
    };
}

function getInboxDocumentCommentThreadEntryDisplay({
    entry,
    locale,
    currentAccount,
}: {
    entry: InboxDocumentCommentThreadEntryModel;
    locale: Locale;
    currentAccount: AccountModel | AccountModelData | AccountModelDataWithoutAvatar | null;
}): InboxEntryDisplayContent {
    const featuredAccount: AccountModel =
        entry.firstCommentAuthor.id !== currentAccount?.id
            ? entry.firstCommentAuthor
            : (entry.otherCommentAuthor ?? entry.latestComment.author);

    const otherAccount: AccountModel | null =
        entry.latestComment?.author.id !== featuredAccount.id
            ? (entry.latestComment?.author ?? null)
            : null;

    const documentTitle = entry.document.isPrivate
        ? entry.document.isDeleted
            ? "a deleted document"
            : "a private document"
        : `\u201C${truncateDocumentTitleForNotification(entry.document.document.getTitle())}\u201D`;

    const title: Array<InboxEntryDisplayContentTitleItem> = [];

    if (entry.isFromNewCommentThread) {
        // When we archive a comment thread in `DocumentNewCommentThreadsEntry` we create
        // an archived `DocumentCommentThreadEntry` with `isFromNewCommentThread: true`.
        // Render this `DocumentCommentThreadEntry` the same as a
        // `DocumentNewCommentThreadsEntry` with one comment thread.
        return getInboxDocumentNewCommentThreadsEntryDisplay({
            locale,
            entry: {
                document: entry.document,
                commentThreadIds: new Set([entry.commentThreadId]),
                commentThreadAuthorCount: 1,
                firstCommentThread: {
                    id: entry.commentThreadId,
                    ...entry.latestComment,
                },
                otherCommentThreadAuthor: null,
            },
        });
    } else if (entry.latestComment.isStickyMention) {
        title.push(entry.latestComment.author);
        title.push(" mentioned you in ");

        if (currentAccount?.id === entry.firstCommentAuthor.id) {
            title.push("your");
        } else if (entry.latestComment.author.id === entry.firstCommentAuthor.id) {
            title.push("their");
        } else {
            title.push(entry.firstCommentAuthor);
            title.push("\u2019s");
        }

        title.push(` comment thread on ${documentTitle}`);
    } else {
        if (currentAccount?.id === entry.firstCommentAuthor.id) {
            title.push("Your");
        } else {
            title.push(entry.firstCommentAuthor);
            title.push("\u2019s");
        }

        title.push(` thread on ${documentTitle} has new comments`);
    }

    return {
        time: entry.latestComment.createdTime,
        brandIconType: "Document",
        featuredAccount: featuredAccount,
        otherAccount: otherAccount,
        latestMessage: entry.latestComment,
        title,
    };
}

function getInboxDocumentNewCommentThreadsEntryDisplay({
    entry,
    locale,
}: {
    entry: Pick<
        InboxDocumentNewCommentThreadsEntryModel,
        | "document"
        | "commentThreadIds"
        | "commentThreadAuthorCount"
        | "firstCommentThread"
        | "otherCommentThreadAuthor"
    >;
    locale: Locale;
}): InboxEntryDisplayContent {
    const featuredAccount: AccountModel =
        entry.otherCommentThreadAuthor ?? entry.firstCommentThread.author;

    const otherAccount: AccountModel | null =
        entry.firstCommentThread.author.id !== featuredAccount.id
            ? entry.firstCommentThread.author
            : null;

    const documentTitle = entry.document.isPrivate
        ? entry.document.isDeleted
            ? "a deleted document"
            : "a private document"
        : `\u201C${truncateDocumentTitleForNotification(entry.document.document.getTitle())}\u201D`;

    const title: Array<InboxEntryDisplayContentTitleItem> = [];

    title.push(printPrettySmallNumberSummary(entry.commentThreadIds.size, "new comment thread"));
    title.push(` on ${documentTitle} by `);

    if (!otherAccount) {
        title.push(featuredAccount);
    } else if (entry.commentThreadAuthorCount <= 2) {
        title.push(otherAccount);
        title.push(" and ");
        title.push(featuredAccount);
    } else {
        title.push(otherAccount);
        title.push(", ");
        title.push(featuredAccount);
        title.push(", and ");
        title.push(printPrettyNumber(locale, entry.commentThreadAuthorCount - 2, "other"));
    }

    return {
        time: entry.firstCommentThread.createdTime,
        brandIconType: "Document",
        featuredAccount: featuredAccount,
        otherAccount: otherAccount,
        latestMessage: entry.firstCommentThread,
        title,
    };
}

function getInboxTaskEntryDisplay({
    entry,
    currentAccount,
}: {
    entry: InboxTaskEntryModel;
    currentAccount: AccountModel | AccountModelData | AccountModelDataWithoutAvatar | null;
}): InboxEntryDisplayContent {
    const featuredAccount =
        entry.otherCommentAuthor ??
        entry.latestComment?.author ??
        (!entry.task.isPrivate ? entry.task.taskOwner : null);

    const otherAccount =
        entry.latestComment?.author.id !== featuredAccount.id
            ? (entry.latestComment?.author ?? null)
            : null;

    const title: Array<InboxEntryDisplayContentTitleItem> = [];

    if (entry.latestComment?.isStickyMention) {
        title.push(entry.latestComment.author);
        title.push(" mentioned you in a comment on ");

        if (entry.task.isPrivate) {
            if (entry.task.isDeleted) {
                title.push(" a deleted task");
            } else {
                title.push(" a private task");
            }
        } else {
            if (currentAccount?.id === entry.task.taskOwner.id) {
                title.push("your");
            } else if (entry.latestComment.author.id === entry.task.taskOwner.id) {
                title.push("their");
            } else {
                title.push(entry.task.taskOwner);
                title.push("\u2019s");
            }

            title.push(" task");
        }
    } else {
        if (entry.task.isPrivate) {
            title.push("A private task");
        } else {
            if (currentAccount?.id === entry.task.taskOwner.id) {
                title.push("Your");
            } else {
                title.push(entry.task.taskOwner);
                title.push("\u2019s");
            }

            title.push(" task");
        }

        title.push(" has new comments");
    }

    return {
        time: entry.latestComment.createdTime,
        brandIconType: "Task",
        featuredAccount,
        otherAccount,
        latestMessage: entry.latestComment,
        title,
    };
}
