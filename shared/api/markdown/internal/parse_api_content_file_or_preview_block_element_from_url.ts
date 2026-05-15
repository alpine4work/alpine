import {
    ApiContentFileBlockElement,
    ApiContentPreviewBlockElement,
    ApiMentionTarget,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {isId} from "~/shared/id/id.js";
import {
    ChannelId,
    ChatId,
    DocumentId,
    FileId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

/**
 * Parse a URL string into a File or Preview block element if it matches our
 * `https://alpine.inc/s/{spaceId}/...` patterns.
 */
export type ApiContentFileOrPreviewBlockElement =
    | ApiContentFileBlockElement
    | ApiContentPreviewBlockElement;

export function parseApiContentFileOrPreviewBlockElementFromUrl(
    spaceId: SpaceId,
    urlString: string,
): ApiContentFileOrPreviewBlockElement | null {
    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        return null;
    }

    if (url.protocol !== "https:" || url.host !== "alpine.inc") {
        return null;
    }

    if (!url.pathname.startsWith(`/s/${spaceId}/`)) {
        return null;
    }

    const pathSegments = url.pathname.slice(`/s/${spaceId}/`.length).split("/");

    // File URL: /s/{spaceId}/files/{fileId}/content (or the legacy
    // /s/{spaceId}/files/{fileId} without the suffix).
    const fileSegment = pathSegments[1];
    if (
        pathSegments[0] === "files" &&
        fileSegment !== undefined &&
        isId<FileId>(fileSegment) &&
        ((pathSegments.length === 3 && pathSegments[2] === "content") || pathSegments.length === 2)
    ) {
        return {type: "File", id: fileSegment};
    }

    // Preview URL: /s/{spaceId}/{entityType}/{entityId}/preview
    const lastSegment = pathSegments[pathSegments.length - 1];
    if (lastSegment === "preview") {
        const target = parsePreviewTargetFromPathSegments(pathSegments.slice(0, -1));
        if (target !== null) {
            return {type: "Preview", target};
        }
    }

    return null;
}

/**
 * Parse path segments into a preview target. Follows the same pattern as
 * `parseApiMentionTargetIfPossible` but without Account.
 */
function parsePreviewTargetFromPathSegments(
    pathSegments: Array<string>,
): Exclude<ApiMentionTarget, {type: "Account"}> | null {
    if (pathSegments.length === 2) {
        const pathSegment1 = pathSegments[0]!;
        const pathSegment2 = pathSegments[1]!;

        // TODO(#sites): Add Site to PreviewTarget.
        switch (pathSegment1) {
            case "channels": {
                if (isId<ChannelId>(pathSegment2)) {
                    return {type: "Channel", id: pathSegment2};
                }
                break;
            }
            case "chats": {
                if (isId<ChatId>(pathSegment2)) {
                    return {type: "Chat", id: pathSegment2};
                }
                break;
            }
            case "documents": {
                if (isId<DocumentId>(pathSegment2)) {
                    return {type: "Document", id: pathSegment2};
                }
                break;
            }
            case "posts": {
                if (isId<PostId>(pathSegment2)) {
                    return {type: "Post", id: pathSegment2};
                }
                break;
            }
            case "tasks": {
                if (isId<TaskId>(pathSegment2)) {
                    return {type: "Task", id: pathSegment2};
                }
                break;
            }
        }
    } else if (pathSegments.length === 3) {
        const collectionSegment = pathSegments[2];
        if (
            pathSegments[0] === "tasks" &&
            pathSegments[1] === "collections" &&
            collectionSegment !== undefined &&
            isId<TaskCollectionId>(collectionSegment)
        ) {
            return {
                type: "TaskCollection",
                id: collectionSegment,
            };
        }
    }

    return null;
}
