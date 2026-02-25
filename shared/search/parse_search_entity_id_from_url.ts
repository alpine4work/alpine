import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Parses a `SearchMentionEntityId` from a pathname. Returns `null` if
 * no matching entity pattern is found in the pathname.
 *
 * This is a lower-level function that doesn't validate URL or spaceId.
 * Use `parseSearchEntityIdFromUrl` if you need those validations.
 *
 * Matches the following patterns:
 * - `/s/{spaceId}/documents/{documentId}` → `Document:{documentId}`
 * - `/s/{spaceId}/tasks/{taskId}` → `Task:{taskId}`
 * - `/s/{spaceId}/posts/{postId}` → `Post:{postId}`
 * - `/s/{spaceId}/channels/{channelId}` → `Channel:{channelId}`
 * - `/s/{spaceId}/tasks/collections/{collectionId}` → `TaskCollection:{collectionId}`
 */
export function parseSearchEntityIdFromPathname(
    spaceId: SpaceId,
    pathname: string,
): SearchMentionEntityId | null {
    // window is undefined in case of SSR. We can default to alpine.inc in that case
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://alpine.inc";
    const url = new URL(pathname, baseUrl);

    const entityId = parseSearchEntityIdFromUrl(spaceId, url.toString());

    if (!entityId || isAccountEntityId(entityId)) return null;

    return entityId;
}

/**
 * Parses a `SearchEntityId` from a URL. Currently, we only support
 * `SearchMentionEntityId`s. If the entity is not in the provided
 * `SpaceId` or is not a valid `SearchEntityId`, `null` is returned.
 */
export function parseSearchEntityIdFromUrl(
    spaceId: SpaceId,
    urlString: string,
): SearchMentionEntityId | `Account:${AccountId}` | null {
    if (!urlString || !/^https?:\/\//.test(urlString) || /\s/.test(urlString)) return null;

    // Make sure it's a valid URL.
    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        return null;
    }

    // Make sure the URL is from the same host that we're currently on.
    // During SSR, window is undefined, so we return null.
    if (typeof window === "undefined" || url.host !== window.location.host) return null;

    {
        const accountMatch = url.pathname.match(/^\/s\/([^/]+)\/chat\/with\/([^/]+)\/?$/);
        if (accountMatch && accountMatch[1] === spaceId && isId<AccountId>(accountMatch[2]!)) {
            return `Account:${accountMatch[2]}`;
        }
    }

    {
        const documentMatch = url.pathname.match(/^\/s\/([^/]+)\/documents\/([^/]+)\/?$/);
        if (documentMatch && documentMatch[1] === spaceId && isId<DocumentId>(documentMatch[2]!)) {
            return `Document:${documentMatch[2]}`;
        }
    }

    {
        const channelMatch = url.pathname.match(/^\/s\/([^/]+)\/channels\/([^/]+)\/?$/);
        if (channelMatch && channelMatch[1] === spaceId && isId<ChannelId>(channelMatch[2]!)) {
            return `Channel:${channelMatch[2]}`;
        }
    }

    {
        const chatMatch = url.pathname.match(/^\/s\/([^/]+)\/chat\/([^/]+)\/?$/);
        if (chatMatch && chatMatch[1] === spaceId && isId<ChatId>(chatMatch[2]!)) {
            return `Chat:${chatMatch[2]}`;
        }
    }

    {
        const postMatch = url.pathname.match(/^\/s\/([^/]+)\/posts\/([^/]+)\/?$/);
        if (postMatch && postMatch[1] === spaceId && isId<PostId>(postMatch[2]!)) {
            return `Post:${postMatch[2]}`;
        }
    }

    {
        const taskMatch = url.pathname.match(/^\/s\/([^/]+)\/tasks\/([^/]+)\/?$/);
        if (taskMatch && taskMatch[1] === spaceId && isId<TaskId>(taskMatch[2]!)) {
            return `Task:${taskMatch[2]}`;
        }
    }

    {
        const taskCollectionMatch = url.pathname.match(
            /^\/s\/([^/]+)\/tasks\/collections\/([^/]+)\/?$/,
        );
        if (
            taskCollectionMatch &&
            taskCollectionMatch[1] === spaceId &&
            isId<TaskCollectionId>(taskCollectionMatch[2]!)
        ) {
            return `TaskCollection:${taskCollectionMatch[2]}`;
        }
    }

    return null;
}

function isAccountEntityId(
    entityId: SearchMentionEntityId | `Account:${AccountId}`,
): entityId is `Account:${AccountId}` {
    return entityId.startsWith(`Account:`);
}
