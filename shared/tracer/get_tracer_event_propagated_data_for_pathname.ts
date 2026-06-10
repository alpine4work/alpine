import {assert} from "~/shared/helpers/control/assert.js";
import {isId} from "~/shared/id/id.js";
import {
    ChannelId,
    ChatId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Parses a path from our app and returns `TracerEventData` with information in the
 * path. We add this as propagated data to all spans created for the path.
 */
export function getTracerEventPropagatedDataForPathname(pathname: string): TracerEventData | null {
    assert(pathname.startsWith("/"));

    let pathnameParts = pathname.slice(1).split("/");

    // Remove `peek` from the path so paths like `/peek/task/:taskId` will correctly
    // parse out the `TaskId`.
    if (pathnameParts[0] === "peek") pathnameParts = pathnameParts.slice(1);

    if (pathnameParts.length >= 2) {
        switch (pathnameParts[0]) {
            case "channel": {
                const channelId = pathnameParts[1]!;
                if (isId<ChannelId>(channelId)) {
                    return {context: {channelId}};
                }
                break;
            }
            case "chat": {
                const chatId = pathnameParts[1]!;
                if (isId<ChatId>(chatId)) {
                    return {context: {chatId}};
                }
                break;
            }
            case "doc": {
                const documentId = pathnameParts[1]!;
                if (isId<DocumentId>(documentId)) {
                    return {context: {documentId}};
                }
                break;
            }
            case "post": {
                const postId = pathnameParts[1]!;
                if (isId<PostId>(postId)) {
                    return {context: {postId}};
                }
                break;
            }
            case "task": {
                const taskId = pathnameParts[1]!;
                if (isId<TaskId>(taskId)) {
                    return {context: {taskId}};
                }
                break;
            }
            case "task-collection": {
                const collectionId = pathnameParts[1]!;
                if (isId<TaskCollectionId>(collectionId)) {
                    return {context: {taskCollectionId: collectionId}};
                }
                break;
            }
            case "notifications": {
                if (pathnameParts.length >= 3) {
                    switch (pathnameParts[1]) {
                        case "channel-posts": {
                            const channelIdAndBucketGeneration = pathnameParts[2]!;
                            const [channelId] = channelIdAndBucketGeneration.split("-");
                            if (channelId && isId<ChannelId>(channelId)) {
                                return {context: {channelId}};
                            }
                            break;
                        }
                        case "document-threads": {
                            const documentIdAndBucketGeneration = pathnameParts[2]!;
                            const [documentId] = documentIdAndBucketGeneration.split("-");
                            if (documentId && isId<DocumentId>(documentId)) {
                                return {context: {documentId}};
                            }
                            break;
                        }
                    }
                }
                break;
            }
        }
    }

    return null;
}
