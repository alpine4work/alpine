import {isId} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * A current Alpine route produced from a legacy space-scoped URL.
 */
export type ConvertLegacySpacePathResult = {
    /**
     * The space parsed from the legacy `/s/{spaceId}` route prefix.
     */
    readonly spaceId: SpaceId;

    /**
     * The converted pathname without search params or hash.
     */
    readonly pathname: string;

    /**
     * The converted search string, including the leading `?` when params exist.
     */
    readonly search: string;
};

/**
 * Converts a legacy `/s/{spaceId}/...` URL path to the current route shape.
 *
 * Returns `null` when the path is not a recognized legacy space route. The
 * returned search string includes existing params and any params required by the
 * current route, such as a document comment thread.
 */
export function convertLegacySpacePath({
    pathname,
    search,
}: {
    pathname: string;
    search: string | URLSearchParams;
}): ConvertLegacySpacePathResult | null {
    if (!pathname.startsWith("/")) return null;

    const segments = pathname.slice(1).split("/");
    if (segments[0] !== "s") return null;

    const spaceId = segments[1];
    if (!spaceId || !isId<SpaceId>(spaceId)) return null;

    const searchParams = new URLSearchParams(search);

    const convertedPathname = convertLegacySpacePathSegments(
        spaceId,
        segments.slice(2),
        searchParams,
        false,
    );
    if (!convertedPathname) return null;

    const searchString = searchParams.toString();
    return {
        spaceId,
        pathname: convertedPathname,
        search: searchString ? `?${searchString}` : "",
    };
}

function convertLegacySpacePathSegments(
    spaceId: SpaceId,
    segments: ReadonlyArray<string>,
    searchParams: URLSearchParams,
    isPeek: boolean,
): string | null {
    const first = segments[0];

    if (!first) return isPeek ? "/peek" : `/home/${spaceId}`;

    switch (first) {
        case "peek": {
            if (segments.length === 1) return "/peek";
            const convertedPathname = convertLegacySpacePathSegments(
                spaceId,
                segments.slice(1),
                searchParams,
                true,
            );
            if (!convertedPathname) return null;
            return `/peek${convertedPathname}`;
        }
        case "accounts": {
            if (segments.length !== 2) return null;
            return path("account", segments[1], spaceId);
        }
        case "channels": {
            if (segments[1] === "new") {
                if (segments.length !== 2) return null;
                return path("channel", "new", spaceId);
            }
            if (segments[2] === "files") {
                if (segments.length !== 3) return null;
                return path("channel", segments[1], "files");
            }
            if (segments.length !== 2) return null;
            return path("channel", segments[1]);
        }
        case "chat": {
            if (segments[1] === "new") {
                if (segments.length !== 2) return null;
                return path("chat", "new", spaceId);
            }
            if (segments[1] === "room" && segments[2] === "new") {
                if (segments.length !== 3) return null;
                return path("chat", "room", "new", spaceId);
            }
            if (segments[1] === "with") {
                if (segments.length !== 3) return null;
                return path("chat", "with", segments[2], spaceId);
            }
            if (segments[2] === "messages" && segments[4] === "reactions") {
                if (segments.length !== 5) return null;
                return path("chat", segments[1], "message", segments[3], "reactions");
            }
            if (segments.length !== 2) return null;
            return path("chat", segments[1]);
        }
        case "create": {
            if (segments[1] === "more") {
                if (segments.length !== 2) return null;
                return path("create", spaceId, "more");
            }
            if (segments.length !== 1) return null;
            return path("create", spaceId);
        }
        case "dev": {
            if (segments.length !== 2) return null;
            return path("dev", segments[1], spaceId);
        }
        case "documents": {
            return convertLegacyDocumentPath(segments, searchParams);
        }
        case "favorites": {
            if (segments.length !== 1) return null;
            return path("favorites", spaceId);
        }
        case "inbox": {
            if (segments.length !== 1) return null;
            return path("inbox", spaceId);
        }
        case "integrations": {
            if (segments[1] === "slack" && segments[2] === "oauth") {
                if (segments.length !== 3) return null;
                return path("integrations", "slack", "oauth", spaceId);
            }
            return null;
        }
        case "invite": {
            if (isPeek) return null;
            if (segments.length !== 2) return null;
            return path("invite", spaceId, segments[1]);
        }
        case "more": {
            if (segments[1] === "settings") {
                if (segments.length !== 2) return null;
                return path("more", "settings", spaceId);
            }
            if (segments[1] === "switch-space") {
                if (segments.length !== 2) return null;
                return path("more", "switch-space", spaceId);
            }
            return path("more", spaceId);
        }
        case "notifications": {
            if (segments[1] === "channel-posts") {
                if (segments.length !== 3) return null;
                return path("notifications", "channel-posts", segments[2]);
            }
            if (segments[1] === "document-comment-threads") {
                if (segments.length !== 3) return null;
                return path("notifications", "document-threads", segments[2]);
            }
            if (segments[1] === "unsubscribe") {
                if (segments.length !== 2) return null;
                return path("notifications", "unsubscribe", spaceId);
            }
            return null;
        }
        case "posts": {
            if (segments[1] === "new") {
                if (segments.length !== 3) return null;
                return path("post", "new", segments[2], spaceId);
            }
            if (segments[2] === "comments" && segments[4] === "reactions") {
                if (segments.length !== 5) return null;
                return path("post", segments[1], "comment", segments[3], "reactions");
            }
            if (segments[2] === "reactions") {
                if (segments.length !== 3) return null;
                return path("post", segments[1], "reactions");
            }
            if (segments.length !== 2) return null;
            return path("post", segments[1]);
        }
        case "search": {
            if (segments.length !== 1) return null;
            return path("search", spaceId);
        }
        case "settings": {
            return path("settings", spaceId, ...segments.slice(1));
        }
        case "sites": {
            if (segments.length !== 2) return null;
            return path("site", segments[1]);
        }
        case "tasks": {
            return convertLegacyTaskPath(spaceId, segments);
        }
        default: {
            return null;
        }
    }
}

function convertLegacyDocumentPath(
    segments: ReadonlyArray<string>,
    searchParams: URLSearchParams,
): string | null {
    if (segments[2] === "duplicate") {
        if (segments.length !== 3) return null;
        return path("doc", segments[1], "duplicate");
    }

    if (segments[2] === "comments") {
        if (segments[5] === "reactions") {
            if (segments.length !== 6) return null;

            return path(
                "doc",
                segments[1],
                "thread",
                segments[3],
                "comment",
                segments[4],
                "reactions",
            );
        }

        if (segments.length !== 4) return null;
        return path("doc", segments[1], "thread", segments[3]);
    }

    if (segments.length !== 2) return null;

    const commentsSearchParam = searchParams.get("comments");
    if (commentsSearchParam !== null) {
        searchParams.delete("comments");
        searchParams.set("thread", commentsSearchParam);
    }

    return path("doc", segments[1]);
}

function convertLegacyTaskPath(spaceId: SpaceId, segments: ReadonlyArray<string>): string | null {
    if (!segments[1]) {
        return path("my-tasks", spaceId);
    }
    if (segments[1] === "view") {
        if (segments.length !== 2) return null;
        return path("task-view", "new", spaceId);
    }
    if (segments[1] === "collections") {
        if (segments.length !== 3) return null;
        return path("task-collection", segments[2]);
    }
    if (segments[2] === "comments" && segments[4] === "reactions") {
        if (segments.length !== 5) return null;
        return path("task", segments[1], "comment", segments[3], "reactions");
    }
    if (segments[2] === "duplicate") {
        if (segments.length !== 3) return null;
        return path("task", segments[1], "duplicate");
    }
    if (segments.length !== 2) return null;
    return path("task", segments[1]);
}

function path(...segments: Array<string | undefined>): string | null {
    const parts: Array<string> = [];

    for (const segment of segments) {
        if (segment === undefined) return null;
        if (segment === "") continue;
        parts.push(segment);
    }

    return `/${parts.join("/")}`;
}
