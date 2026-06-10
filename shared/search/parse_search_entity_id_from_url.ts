import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    PostId,
    SiteId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {convertLegacySpacePath} from "~/shared/search/convert_legacy_space_path.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Parses a `SearchMentionEntityId` from a URL. Returns `null` if no matching
 * entity pattern is found in a same-host HTTP(S) URL.
 *
 * Matches the following patterns:
 *
 * - `/doc/{documentId}` → `Document:{documentId}`
 * - `/task/{taskId}` → `Task:{taskId}`
 * - `/post/{postId}` → `Post:{postId}`
 * - `/channel/{channelId}` → `Channel:{channelId}`
 * - `/task-collection/{collectionId}` → `TaskCollection:{collectionId}`
 * - `/site/{siteId}` → `Site:{siteId}`
 */
export function parseSearchEntityIdFromUrl(
    urlString: string,
): SearchMentionEntityId | `Account:${AccountId}` | null {
    if (!urlString || /\s/.test(urlString)) return null;

    // Make sure it's a valid URL.
    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    // Make sure the URL is from the same host that we're currently on. During SSR,
    // window is undefined, so we return null.
    if (typeof window === "undefined" || url.host !== window.location.host) return null;

    const legacySpacePathResult = convertLegacySpacePath({
        pathname: url.pathname,
        search: url.search,
    });
    if (legacySpacePathResult) {
        url.pathname = legacySpacePathResult.pathname;
        url.search = legacySpacePathResult.search;
    }

    const pathSegments = url.pathname.split("/");
    if (pathSegments[0] !== "") return null;
    if (pathSegments[pathSegments.length - 1] === "") pathSegments.pop();

    switch (pathSegments[1]) {
        case "mention": {
            if (pathSegments.length !== 3) return null;

            const accountId = pathSegments[2]!;
            if (!isId<AccountId>(accountId)) return null;

            return `Account:${accountId}`;
        }
        case "account": {
            if (pathSegments.length !== 4) return null;

            const accountId = pathSegments[2]!;
            if (!isId<AccountId>(accountId)) return null;

            return `Account:${accountId}`;
        }
        case "doc": {
            if (pathSegments.length !== 3) return null;

            const documentId = pathSegments[2]!;
            if (!isId<DocumentId>(documentId)) return null;

            return `Document:${documentId}`;
        }
        case "channel": {
            if (pathSegments.length !== 3) return null;

            const channelId = pathSegments[2]!;
            if (!isId<ChannelId>(channelId)) return null;

            return `Channel:${channelId}`;
        }
        case "chat": {
            if (pathSegments[2] === "with") {
                if (pathSegments.length !== 5) return null;

                const accountId = pathSegments[3]!;
                if (!isId<AccountId>(accountId)) return null;

                return `Account:${accountId}`;
            }
            if (pathSegments.length !== 3) return null;

            const chatId = pathSegments[2]!;
            if (!isId<ChatId>(chatId)) return null;

            return `Chat:${chatId}`;
        }
        case "post": {
            if (pathSegments.length !== 3) return null;

            const postId = pathSegments[2]!;
            if (!isId<PostId>(postId)) return null;

            return `Post:${postId}`;
        }
        case "task": {
            if (pathSegments.length !== 3) return null;

            const taskId = pathSegments[2]!;
            if (!isId<TaskId>(taskId)) return null;

            return `Task:${taskId}`;
        }
        case "task-collection": {
            if (pathSegments.length !== 3) return null;

            const collectionId = pathSegments[2]!;
            if (!isId<TaskCollectionId>(collectionId)) return null;

            return `TaskCollection:${collectionId}`;
        }
        case "site": {
            if (pathSegments.length !== 3) return null;

            const siteId = pathSegments[2]!;
            if (!isId<SiteId>(siteId)) return null;

            return `Site:${siteId}`;
        }
        default: {
            return null;
        }
    }
}
