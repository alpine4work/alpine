import {getSearchEntityMentionTitleForApi} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    ApiChatReference,
    ApiDocumentReference,
    ApiInboxEntry,
    ApiInboxEntryPreviewItem,
    ApiInboxEntryTitleItem,
    ApiPostReference,
    ApiTaskReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ContentReferencesSearchEntity} from "~/shared/content/content_references.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.open_source.js";
import {ChatId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    InboxEntryDisplayContent,
    InboxEntryDisplayContentTitle,
    getInboxEntryDisplayContent,
} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {
    InboxDocumentCommentThreadEntryModel,
    InboxEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";

/**
 * Converts an inbox entry model into its API response.
 *
 * If the entry references a Chat or Task entity, the caller must pass in the
 * already resolved entity via `resolvedReferenceEntity`, as these entities are not
 * normally available on inbox entry models.
 */
export function intoApiInboxEntry(
    entry: InboxEntryModel,
    resolvedReferenceEntity: ContentReferencesSearchEntity | null,
): ApiInboxEntry {
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
        ...intoApiInboxEntryReference(entry, resolvedReferenceEntity),
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
 * Build the preview for an inbox entry as rich text items: an `Account` item for
 * the latest message author followed by a `Text` item with the message snippet
 * (e.g. `Caleb` + `Blah blah blah`). The author is carried here directly rather
 * than via `featured`/`otherAccount`, which can reference a different account
 * (e.g. when you sent the last message). Returns `undefined` when the entry has no
 * message content.
 */
function intoApiInboxEntryPreview(
    display: InboxEntryDisplayContent,
): ReadonlyArray<ApiInboxEntryPreviewItem> | undefined {
    if (!display.latestMessage || display.latestMessage.contentTextSnippet.length === 0) {
        return undefined;
    }

    return [
        {type: "Account", account: intoApiAccount(display.latestMessage.author.initialData)},
        {type: "Text", text: display.latestMessage.contentTextSnippet},
    ];
}

function intoApiInboxEntryReference(
    entry: InboxEntryModel,
    resolvedReferenceEntity: ContentReferencesSearchEntity | null,
): DistributiveOmit<ApiInboxEntry, Exclude<keyof ApiInboxEntry, "type">> {
    switch (entry.type) {
        case "Chat": {
            const chatId = entry.chatId;
            return {
                type: "Chat",
                chat: intoApiInboxEntryChatReference(chatId, resolvedReferenceEntity),
                previewMessage: {index: entry.latestMessage.index},
            };
        }
        case "PostComments": {
            // The post's accessibility mirrors its channel: a private channel hides the post.
            // When accessible the content snippet is the post's derived title; without it the
            // post has been deleted and is no longer retrievable. Inaccessible posts carry a
            // placeholder title and an explicit flag.
            const post: ApiPostReference = entry.channel.isPrivate
                ? {
                      type: "Post",
                      id: entry.postId,
                      title: getSearchEntityMentionTitleForApi(`Post:${entry.postId}`, {
                          isPrivate: true,
                      }),
                      private: true,
                  }
                : entry.postContentTextSnippet !== null
                  ? {type: "Post", id: entry.postId, title: entry.postContentTextSnippet}
                  : {
                        type: "Post",
                        id: entry.postId,
                        title: getSearchEntityMentionTitleForApi(`Post:${entry.postId}`, {
                            isDeleted: true,
                        }),
                        deleted: true,
                    };

            // A body mention links to the post itself, so it omits `previewMessage`. It takes
            // precedence over comments to match how the entry is displayed:
            // `getInboxEntryDisplayContent()` renders a body-mention entry with the post body
            // as its preview even when later comments have set `latestComment`. A comment
            // notification deep-links to the specific comment via `previewMessage`.
            return entry.isForPostContentMention || !entry.latestComment
                ? {type: "Post", post}
                : {type: "Post", post, previewMessage: {index: entry.latestComment.index}};
        }
        case "ChannelPosts":
            return {
                type: "CreatedChannelPosts",
                channel: entry.channel.isPrivate
                    ? {
                          type: "Channel",
                          id: entry.channel.channelId,
                          title: getSearchEntityMentionTitleForApi(
                              `Channel:${entry.channel.channelId}`,
                              {isPrivate: true},
                          ),
                          private: true,
                      }
                    : {
                          type: "Channel",
                          id: entry.channel.channel.id,
                          title: entry.channel.channel.name,
                      },
                posts: Array.from(entry.postIds, id => ({id})),
            };
        case "DocumentCommentThread":
            return {
                type: "DocumentThread",
                document: intoApiInboxEntryDocumentReference(entry.document),
                thread: {id: entry.commentThreadId},
                previewMessage: {index: entry.latestComment.index},
            };
        case "DocumentNewCommentThreads":
            return {
                type: "CreatedDocumentThreads",
                document: intoApiInboxEntryDocumentReference(entry.document),
                threads: Array.from(entry.commentThreadIds, id => ({id})),
            };
        case "Task": {
            const taskId = entry.task.taskId;
            return {
                type: "TaskMessages",
                task: intoApiInboxEntryTaskReference(taskId, resolvedReferenceEntity),
                previewMessage: {index: entry.latestComment.index},
            };
        }
        default:
            throw exhaustive(entry);
    }
}

/**
 * Build a document reference for an inbox entry. A private document exposes only
 * its id with a placeholder title and an explicit `private` flag; otherwise we use
 * the previewed document's id and title.
 */
function intoApiInboxEntryDocumentReference(
    document: InboxDocumentCommentThreadEntryModel["document"],
): ApiDocumentReference {
    if (document.isPrivate) {
        return {
            type: "Document",
            id: document.documentId,
            title: getSearchEntityMentionTitleForApi(`Document:${document.documentId}`, {
                isPrivate: true,
            }),
            private: true,
        };
    }

    return {
        type: "Document",
        id: document.document.id,
        title: document.document.getTitle(),
    };
}

/**
 * Build a task reference for an inbox entry from a search entity resolved by the
 * API layer. The inbox model doesn't carry a task title/status, so we take them
 * from the resolved entity. When the task is inaccessible or gone we fall back to
 * a placeholder title and an explicit `private`/`deleted` flag, mirroring how the
 * task API converter (`api_task_converter.ts`) handles inaccessible parent tasks.
 */
function intoApiInboxEntryTaskReference(
    taskId: TaskId,
    resolvedReferenceEntity: ContentReferencesSearchEntity | null,
): ApiTaskReference {
    const entityId = `Task:${taskId}` as const;

    if (resolvedReferenceEntity === null) {
        return {
            type: "Task",
            id: taskId,
            title: getSearchEntityMentionTitleForApi(entityId, {isDeleted: true}),
            status: intoApiTaskStatus("Closed"),
            deleted: true,
        };
    }

    if (resolvedReferenceEntity.isPrivate) {
        return {
            type: "Task",
            id: taskId,
            title: getSearchEntityMentionTitleForApi(entityId, {isPrivate: true}),
            status: intoApiTaskStatus("Closed"),
            private: true,
        };
    }

    const {initialData} = resolvedReferenceEntity.entity;
    assert(initialData.type === "Task");

    // A deleted task can linger in the index with a null title. Treat it as deleted.
    if (initialData.title === null) {
        return {
            type: "Task",
            id: taskId,
            title: getSearchEntityMentionTitleForApi(entityId, {isDeleted: true}),
            status: intoApiTaskStatus("Closed"),
            deleted: true,
        };
    }

    return {
        type: "Task",
        id: taskId,
        title: getSearchEntityMentionTitleForApi(entityId, resolvedReferenceEntity),
        status: intoApiTaskStatus(initialData.task.displayStatus.value),
    };
}

/**
 * Build a chat reference for an inbox entry from a search entity resolved by the
 * API layer. The inbox model doesn't carry a chat title (a room's name or a direct
 * chat's member-derived name), so we take it from the resolved entity. When the
 * chat is inaccessible or gone we fall back to a placeholder title and an explicit
 * `private`/`deleted` flag, matching how task references are built.
 */
function intoApiInboxEntryChatReference(
    chatId: ChatId,
    resolvedReferenceEntity: ContentReferencesSearchEntity | null,
): ApiChatReference {
    const entityId = `Chat:${chatId}` as const;

    // The chat no longer exists. We still expose its id but can't show a title.
    if (resolvedReferenceEntity === null) {
        return {
            type: "Chat",
            id: chatId,
            title: getSearchEntityMentionTitleForApi(entityId, {isDeleted: true}),
            deleted: true,
        };
    }

    if (resolvedReferenceEntity.isPrivate) {
        return {
            type: "Chat",
            id: chatId,
            title: getSearchEntityMentionTitleForApi(entityId, {isPrivate: true}),
            private: true,
        };
    }

    const {initialData} = resolvedReferenceEntity.entity;
    assert(initialData.type === "Chat");

    // A deleted chat can linger in the index with a null title. Treat it as deleted.
    if (initialData.title === null) {
        return {
            type: "Chat",
            id: chatId,
            title: getSearchEntityMentionTitleForApi(entityId, {isDeleted: true}),
            deleted: true,
        };
    }

    return {
        type: "Chat",
        id: chatId,
        title: getSearchEntityMentionTitleForApi(entityId, resolvedReferenceEntity),
    };
}
