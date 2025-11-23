import {Memo, ReactNode, useMemo} from "react";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {archiveInboxChannelPostsEntryPostOptimistically} from "~/client/web/inbox/archive_inbox_channel_posts_entry_post_optimistically.js";
import {archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically} from "~/client/web/inbox/archive_inbox_document_new_comment_threads_entry_comment_thread_optimistically.js";
import {archiveInboxEntryOptimistically} from "~/client/web/inbox/archive_inbox_entry_optimistically.js";
import {
    InboxContextCreateMessageOptimisticallyRoom,
    InboxContextNavigation,
} from "~/client/web/inbox/inbox_context_types.js";
import {InboxContextDefinition} from "~/client/web/inbox/internal/inbox_context_definition.js";
import {
    decodePossiblyDocumentCommentRoomKey,
    encodeDocumentCommentRoomKey,
} from "~/shared/documents/document_model.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, PostId} from "~/shared/id/types/id_types.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

export function InboxContextProvider({
    entry,
    navigation = null,
    children,
}: {
    entry: DynamoGeneralRealtimeItem<InboxEntryModel> | null;
    navigation?: Memo<InboxContextNavigation> | null;
    children?: ReactNode;
}) {
    const onCreateMessageOptimistically = useEvent(
        (promise: Promise<unknown>, room?: InboxContextCreateMessageOptimisticallyRoom) => {
            // We may not have an entry if the path in the URL is no longer in the inbox
            // entries query.
            if (!entry) return;

            // Only new entries implicitly dismiss on message creation.
            if (entry.model.isArchived) return;

            switch (entry.model.type) {
                case "Chat":
                case "PostComments":
                case "Task":
                case "DocumentCommentThread": {
                    archiveInboxEntryOptimistically({
                        promise,
                        entry,
                        withAnimation: true,
                    });
                    break;
                }
                case "ChannelPosts": {
                    if (room?.type === "Post") {
                        archiveInboxChannelPostsEntryPostOptimistically({
                            promise,
                            entryKey: entry.key,
                            postId: room.postId,
                        });
                    }
                    break;
                }
                case "DocumentNewCommentThreads": {
                    if (room?.type === "DocumentCommentThread") {
                        archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically({
                            promise,
                            entryKey: entry.key,
                            commentThreadId: room.commentThreadId,
                        });
                    }
                    break;
                }
                default:
                    throw exhaustive(entry.model);
            }
        },
    );

    const onSetMessageReactionOptimistically = useEvent(
        (promise: Promise<unknown>, roomKey: string) => {
            // We may not have an entry if the path in the URL is no longer in the inbox
            // entries query.
            if (!entry) return;

            // Only new entries implicitly dismiss on message creation.
            if (entry.model.isArchived) return;

            switch (entry.model.type) {
                case "Chat": {
                    if (entry.model.chatId === roomKey) {
                        archiveInboxEntryOptimistically({
                            promise,
                            entry,
                            withAnimation: true,
                        });
                    }
                    break;
                }
                case "PostComments": {
                    if (entry.model.postId === roomKey) {
                        archiveInboxEntryOptimistically({
                            promise,
                            entry,
                            withAnimation: true,
                        });
                    }
                    break;
                }
                case "Task": {
                    if (entry.model.task.taskId === roomKey) {
                        archiveInboxEntryOptimistically({
                            promise,
                            entry,
                            withAnimation: true,
                        });
                    }
                    break;
                }
                case "DocumentCommentThread": {
                    const actualRoomKey = encodeDocumentCommentRoomKey(
                        entry.model.getDocumentId(),
                        entry.model.commentThreadId,
                    );

                    if (actualRoomKey === roomKey) {
                        archiveInboxEntryOptimistically({
                            promise,
                            entry,
                            withAnimation: true,
                        });
                    }
                    break;
                }
                case "ChannelPosts": {
                    if (isId<PostId>(roomKey)) {
                        archiveInboxChannelPostsEntryPostOptimistically({
                            promise,
                            entryKey: entry.key,
                            postId: roomKey,
                        });
                    }
                    break;
                }
                case "DocumentNewCommentThreads": {
                    const [documentId, commentThreadId] =
                        decodePossiblyDocumentCommentRoomKey(roomKey);

                    if (
                        entry.model.getDocumentId() === documentId &&
                        isId<DocumentCommentThreadId>(commentThreadId)
                    ) {
                        archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically({
                            promise,
                            entryKey: entry.key,
                            commentThreadId,
                        });
                    }
                    break;
                }
                default:
                    throw exhaustive(entry.model);
            }
        },
    );

    return (
        <InboxContextDefinition.Provider
            value={useMemo(
                () => ({
                    entry,
                    navigation,
                    onCreateMessageOptimistically,
                    onSetMessageReactionOptimistically,
                }),
                [
                    entry,
                    navigation,
                    onCreateMessageOptimistically,
                    onSetMessageReactionOptimistically,
                ],
            )}
        >
            {children}
        </InboxContextDefinition.Provider>
    );
}
