import {Memo, ReactNode, useMemo} from "react";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {InboxContextNavigation} from "~/client/inbox/inbox_context_types.js";
import {InboxContextDefinition} from "~/client/inbox/internal/inbox_context_definition.js";
import {archiveInboxChannelPostsEntryPostOptimistically} from "~/client/inbox/use_archive_inbox_channel_posts_entry_post.js";
import {archiveInboxEntryOptimistically} from "~/client/inbox/use_archive_inbox_entry.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
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
        (promise: Promise<unknown>, fileAttachmentTarget: FileAttachmentTarget | null) => {
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
                    // Use the `fileAttachmentTarget` to figure out if this is a message in a post's
                    // comments section. `fileAttachmentTarget` wasn't designed to be used for
                    // checking what messaging surface we're in (it was designed for authenticating
                    // file attachments) but it sure is convenient.
                    if (fileAttachmentTarget?.type === "PostComments") {
                        archiveInboxChannelPostsEntryPostOptimistically({
                            promise,
                            postId: fileAttachmentTarget.postId,
                            entry,
                            withAnimation: true,
                        });
                    }
                    break;
                }
                case "DocumentNewCommentThreads": {
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
                () => ({entry, navigation, onCreateMessageOptimistically}),
                [entry, navigation, onCreateMessageOptimistically],
            )}
        >
            {children}
        </InboxContextDefinition.Provider>
    );
}
