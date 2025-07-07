import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

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
    if (url.host !== window.location.host) return null;

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
