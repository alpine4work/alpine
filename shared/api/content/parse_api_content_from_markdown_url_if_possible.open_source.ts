import {
    ApiContentFileBlockElement,
    ApiContentPreviewBlockElement,
    ApiMentionReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {isId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    FileId,
    PostId,
    SiteId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

export function parseApiMentionReferenceFromMarkdownUrlIfPossible(
    urlString: URL | string,
): ApiMentionReference | null {
    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        return null;
    }

    if (url.protocol !== "https:" || url.host !== "alpine.inc") return null;

    const pathnameSegments = url.pathname.slice(1).split("/");
    if (
        pathnameSegments.length === 2 &&
        pathnameSegments[0] === "mention" &&
        isId<AccountId>(pathnameSegments[1]!)
    ) {
        return {type: "Account", id: pathnameSegments[1]};
    }

    // This link is treated as a mention if it's an `https://alpine.inc` link with a
    // `mention` hash.
    if (url.hash !== "#mention") return null;

    return parseApiMentionReferenceFromMarkdownPathnameSegmentsIfPossible(pathnameSegments);
}

/**
 * Parse a URL string into a File or Preview block element if it matches our
 * `https://alpine.inc/...` file and preview URL patterns.
 */
export type ApiContentFileOrPreviewBlockElement =
    | ApiContentFileBlockElement
    | ApiContentPreviewBlockElement;

export function parseApiContentFileOrPreviewBlockElementFromMarkdownUrlIfPossible(
    urlString: URL | string,
): ApiContentFileOrPreviewBlockElement | null {
    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        return null;
    }

    if (url.protocol !== "https:" || url.host !== "alpine.inc") return null;

    const pathnameSegments = url.pathname.slice(1).split("/");

    // File URL: `/file/{fileId}/content`
    if (
        pathnameSegments.length === 3 &&
        pathnameSegments[0] === "file" &&
        isId<FileId>(pathnameSegments[1]!) &&
        pathnameSegments[2] === "content"
    ) {
        return {type: "File", file: {id: pathnameSegments[1]}};
    }

    // Preview URL: `/{entityType}/{entityId}/preview`
    if (pathnameSegments[pathnameSegments.length - 1] === "preview") {
        const reference = parseApiMentionReferenceFromMarkdownPathnameSegmentsIfPossible(
            pathnameSegments.slice(0, -1),
        );
        if (reference !== null) return {type: "Preview", reference};
    }

    return null;
}

export function parseApiMentionReferenceFromMarkdownPathnameSegmentsIfPossible(
    pathnameSegments: Array<string>,
): Exclude<ApiMentionReference, {type: "Account"}> | null {
    if (pathnameSegments.length !== 2) return null;

    const pathnameSegment1 = pathnameSegments[0]!;
    const pathnameSegment2 = pathnameSegments[1]!;

    switch (pathnameSegment1) {
        case "channel": {
            if (isId<ChannelId>(pathnameSegment2)) {
                return {type: "Channel", id: pathnameSegment2};
            }
            break;
        }
        case "chat": {
            if (isId<ChatId>(pathnameSegment2)) {
                return {type: "Chat", id: pathnameSegment2};
            }
            break;
        }
        case "doc": {
            if (isId<DocumentId>(pathnameSegment2)) {
                return {type: "Document", id: pathnameSegment2};
            }
            break;
        }
        case "post": {
            if (isId<PostId>(pathnameSegment2)) {
                return {type: "Post", id: pathnameSegment2};
            }
            break;
        }
        case "site": {
            if (isId<SiteId>(pathnameSegment2)) {
                return {type: "Site", id: pathnameSegment2};
            }
            break;
        }
        case "task": {
            if (isId<TaskId>(pathnameSegment2)) {
                return {type: "Task", id: pathnameSegment2};
            }
            break;
        }
        case "task-collection": {
            if (isId<TaskCollectionId>(pathnameSegment2)) {
                return {type: "TaskCollection", id: pathnameSegment2};
            }
            break;
        }
    }

    return null;
}
