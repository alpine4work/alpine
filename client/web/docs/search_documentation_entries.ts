/**
 * The data model, generated Fuse index, and ranking for docs search.
 *
 * How it works today\
 * ------------------\
 * At build time, `//client/web/docs:docs_generated` generates a\
 * `generated/search_metadata.json` file containing:
 *
 * 1. `DocumentationSearchEntry` records — one per markdown page and one per API
 *    endpoint.
 * 2. A prebuilt Fuse index over each entry's `title` and hidden `tags`.
 *
 * The page loader sends that JSON to the browser with the rest of the generated
 * docs data. `searchDocumentationEntries()` uses Fuse for matching and typo
 * tolerance, then applies the product ranking we want for docs:
 *
 * 1. markdown pages whose TITLE matched\
 * 2. markdown pages whose only a TAG matched\
 * 3. API docs (always last), title matches before tag matches
 *
 * Page tags come from the `tags:` frontmatter (comma separated). Blog posts\
 * automatically include "blog" and their author's name. API entries include\
 * "api", with endpoint tags also codegened from the HTTP method (POST →\
 * "create", PATCH → "update", …).
 */

import _Fuse from "fuse.js";
import {DocumentationApiMethod} from "~/client/web/docs/documentation_api_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

export type DocumentationSearchEntryType = "page" | "blog" | "api";

export type DocumentationSearchEntry = {
    type: DocumentationSearchEntryType;
    title: string;
    url: string;
    /**
     * Extra search terms that match this entry but are never shown in the UI.
     */
    tags: Array<string>;
    /**
     * A short line shown under the title in the result row (never matched against).
     * Page descriptions come from `description:` frontmatter; API endpoints fall back
     * to their `METHOD /path`.
     */
    description?: string;
};

export type DocumentationSearchResult = {
    entry: DocumentationSearchEntry;
    /** Whether the query matched the title (vs. only a tag). Drives ranking. */
    matchedTitle: boolean;
};

export type DocumentationSearchIndex = {
    entries: Array<DocumentationSearchEntry>;
    fuseIndex: {
        keys: Array<unknown>;
        records: Array<unknown>;
    };
};

const documentationSearchFuseKeys = ["title", "tags"];

const documentationSearchFuseOptions = {
    includeMatches: true,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
    threshold: 0.2,
    keys: documentationSearchFuseKeys,
};

/**
 * Add required surface and author tags while preserving authored search tags.
 */
export function createDocumentationSearchTags(
    options:
        | {type: "api"; tags: ReadonlyArray<string>}
        | {type: "blog"; authorName: string; tags: ReadonlyArray<string>},
): Array<string> {
    let automaticTags;
    switch (options.type) {
        case "api":
            automaticTags = ["api"];
            break;
        case "blog":
            automaticTags = ["blog", options.authorName];
            break;
        default:
            throw exhaustive(options);
    }

    const normalizedTags = new Set<string>();
    const tags: Array<string> = [];
    for (const tag of [...automaticTags, ...options.tags]) {
        // Preserve the first tag's display casing and ordering while treating
        // differently-cased authored tags as duplicates.
        const normalizedTag = tag.toLocaleLowerCase();
        if (normalizedTags.has(normalizedTag)) continue;
        normalizedTags.add(normalizedTag);
        tags.push(tag);
    }
    return tags;
}

/**
 * Build the generated client-side Fuse index for docs search.
 */
export function buildDocumentationSearchIndex(
    entries: ReadonlyArray<DocumentationSearchEntry>,
): DocumentationSearchIndex {
    const fuseIndex = Fuse.createIndex<DocumentationSearchEntry>(
        documentationSearchFuseKeys,
        entries,
    ).toJSON();
    return {
        entries: [...entries],
        fuseIndex: {
            keys: [...fuseIndex.keys],
            records: [...fuseIndex.records],
        },
    };
}

/**
 * Validate the codegened search index (from JSON) into typed entries.
 */
export function parseDocumentationSearchEntries(value: unknown): Array<DocumentationSearchEntry> {
    if (!Array.isArray(value)) return [];

    const entries: Array<DocumentationSearchEntry> = [];
    for (const item of value) {
        if (!isPlainObject(item)) continue;
        const {type, title, url, tags, description} = item;
        if (
            (type === "page" || type === "blog" || type === "api") &&
            typeof title === "string" &&
            typeof url === "string" &&
            Array.isArray(tags)
        ) {
            entries.push({
                type,
                title,
                url,
                tags: tags.filter((tag): tag is string => typeof tag === "string"),
                ...(typeof description === "string" && description.length > 0 ? {description} : {}),
            });
        }
    }
    return entries;
}

/**
 * Validate the generated docs search JSON.
 */
export function parseDocumentationSearchIndex(value: unknown): DocumentationSearchIndex {
    if (!isPlainObject(value)) return buildDocumentationSearchIndex([]);

    const entries = parseDocumentationSearchEntries(value.entries);
    const {fuseIndex} = value;
    if (
        !isPlainObject(fuseIndex) ||
        !Array.isArray(fuseIndex.keys) ||
        !Array.isArray(fuseIndex.records)
    ) {
        return buildDocumentationSearchIndex(entries);
    }

    return {
        entries,
        fuseIndex: {
            keys: [...fuseIndex.keys],
            records: [...fuseIndex.records],
        },
    };
}

/**
 * Synonyms attached to an API endpoint so intent words find it. E.g. searching
 * "create" surfaces every `POST` endpoint even though their titles start with
 * "Create"/"Send".
 */
export function getApiMethodSearchTags(method: DocumentationApiMethod): Array<string> {
    switch (method) {
        case "GET":
            return ["get", "list", "read", "fetch"];
        case "POST":
            return ["create", "add", "new", "send", "post"];
        case "PATCH":
            return ["update", "edit", "modify", "patch"];
        case "PUT":
            return ["update", "replace", "set", "put"];
        case "DELETE":
            return ["delete", "remove", "destroy"];
        default:
            return [];
    }
}

/**
 * Filter and rank docs entries for a query. Guides rank above blog posts, and blog
 * posts rank above API docs. Within each, title matches rank above tag-only
 * matches. Empty queries return no results.
 */
export function searchDocumentationEntries(
    index: DocumentationSearchIndex,
    query: string,
    {limit = 50}: {limit?: number} = {},
): Array<DocumentationSearchResult> {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) return [];

    const fuse = new Fuse<DocumentationSearchEntry>(
        index.entries,
        documentationSearchFuseOptions,
        Fuse.parseIndex<DocumentationSearchEntry>(index.fuseIndex),
    );
    const results = fuse.search(normalizedQuery).map(result => ({
        entry: result.item,
        matchedTitle: result.matches?.some(match => match.key === "title") ?? false,
        score: result.score ?? 1,
    }));

    results.sort(compareDocumentationSearchResults);
    return results.slice(0, limit).map(({entry, matchedTitle}) => ({entry, matchedTitle}));
}

/**
 * Sort search results by surface, match quality, and title.
 */
function compareDocumentationSearchResults(
    result1: DocumentationSearchResult & {score: number},
    result2: DocumentationSearchResult & {score: number},
): number {
    const typeRank1 = getDocumentationSearchEntryTypeRank(result1.entry.type);
    const typeRank2 = getDocumentationSearchEntryTypeRank(result2.entry.type);
    if (typeRank1 !== typeRank2) return typeRank1 - typeRank2;

    // Then title matches before tag-only matches.
    const titleRank1 = result1.matchedTitle ? 0 : 1;
    const titleRank2 = result2.matchedTitle ? 0 : 1;
    if (titleRank1 !== titleRank2) return titleRank1 - titleRank2;

    // Then Fuse relevance within the tier.
    if (result1.score !== result2.score) return result1.score - result2.score;

    // Stable, readable order within a tier.
    return result1.entry.title.localeCompare(result2.entry.title);
}

/**
 * Rank search result surfaces for the docs search dialog.
 */
function getDocumentationSearchEntryTypeRank(type: DocumentationSearchEntryType): number {
    switch (type) {
        case "page":
            return 0;
        case "blog":
            return 1;
        case "api":
            return 2;
        default:
            return 3;
    }
}
