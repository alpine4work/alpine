import {assert} from "~/shared/helpers/control/assert.js";
import {isId} from "~/shared/id/id.js";
import {
    ChannelId,
    ChatId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Parses a path from our app and returns `TracerEventData` with information in
 * the path. We add this as propagated data to all spans created for the path.
 */
export function getTracerEventPropagatedDataForPathname(pathname: string): TracerEventData | null {
    assert(pathname.startsWith("/"));

    const pathnameParts = pathname.slice(1).split("/");

    if (pathnameParts[0] !== "s") return null;

    if (pathnameParts.length === 1) return null;
    const spaceId = pathnameParts[1]!;
    if (!isId<SpaceId>(spaceId)) return null;

    // Remove `peek` from the path so paths like `/s/:spaceId/peek/tasks/:taskId`
    // will correctly parse out the `TaskId`.
    if (pathnameParts[2] === "peek") pathnameParts.splice(2, 1);

    if (pathnameParts.length >= 4) {
        switch (pathnameParts[2]) {
            case "channels": {
                const channelId = pathnameParts[3]!;
                if (isId<ChannelId>(channelId)) {
                    return {context: {spaceId, channelId}};
                }
                break;
            }
            case "chat": {
                const chatId = pathnameParts[3]!;
                if (isId<ChatId>(chatId)) {
                    return {context: {spaceId, chatId}};
                }
                break;
            }
            case "documents": {
                const documentId = pathnameParts[3]!;
                if (isId<DocumentId>(documentId)) {
                    return {context: {spaceId, documentId}};
                }
                break;
            }
            case "posts": {
                const postId = pathnameParts[3]!;
                if (isId<PostId>(postId)) {
                    return {context: {spaceId, postId}};
                }
                break;
            }
            case "tasks": {
                switch (pathnameParts[3]) {
                    case "collections": {
                        if (pathnameParts.length >= 5) {
                            const taskCollectionId = pathnameParts[4]!;
                            if (isId<TaskCollectionId>(taskCollectionId)) {
                                return {context: {spaceId, taskCollectionId}};
                            }
                        }
                        break;
                    }
                    default: {
                        const taskId = pathnameParts[3]!;
                        if (isId<TaskId>(taskId)) {
                            return {context: {spaceId, taskId}};
                        }
                        break;
                    }
                }
                break;
            }
            case "notifications": {
                if (pathnameParts.length >= 5) {
                    switch (pathnameParts[3]) {
                        case "channel-posts": {
                            const channelIdAndBucketGeneration = pathnameParts[4]!;
                            const [channelId] = channelIdAndBucketGeneration.split("-");
                            if (channelId && isId<ChannelId>(channelId)) {
                                return {context: {spaceId, channelId}};
                            }
                            break;
                        }
                        case "document-comment-threads": {
                            const documentIdAndBucketGeneration = pathnameParts[4]!;
                            const [documentId] = documentIdAndBucketGeneration.split("-");
                            if (documentId && isId<DocumentId>(documentId)) {
                                return {context: {spaceId, documentId}};
                            }
                            break;
                        }
                    }
                }
                break;
            }
        }
    }

    return {context: {spaceId}};
}
