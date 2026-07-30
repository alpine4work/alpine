import {ContentReferences, ContentWithReferences} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {getAuthorFromSearchEntityIfExists} from "~/shared/search/get_author_from_search_entity_if_exists.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * The default Open Graph image URL.
 */
export const defaultOpenGraphImageUrl = `${__RESOURCE_SERVICE_URL__}/images/og.jpg`;

/**
 * Get the Open Graph title for a given title.
 */
export const getOpenGraphTitle = (title: string) => `${title} | Alpine`;

export const OpenGraphContentSchema = Schema.object({
    title: Schema.string,
    description: Schema.string.nullable(),
    image: Schema.string,
});

export type OpenGraphContent = SchemaType<typeof OpenGraphContentSchema>;

/**
 * Compute Open Graph metadata for content. Returns the OG title (with " | Alpine"
 * suffix), a description extracted from the content (or null if the content has no
 * text), and the OG image URL.
 */
export function getOpenGraphContent(
    title: string,
    content: ContentWithReferences,
): OpenGraphContent {
    const snippet = getContentSnippet(
        content.doc.resolve(0),
        {linesAbove: 0, linesBelow: 0},
        {ignoreLineBreaks: true, maxLineGraphemeCount: 300},
    );

    const text = printContentSingleLineTextSnippet(
        snippet,
        getReferencesForPrintSingleLineTextSnippet(content.references),
    );

    let description: string | null = null;
    if (text.length > 0) {
        // If the snippet was truncated from the full content, add ellipsis.
        description = snippet.nodeSize < content.doc.nodeSize ? text + "\u2026" : text;
    }

    return {
        title: getOpenGraphTitle(title),
        description,
        image: defaultOpenGraphImageUrl,
    };
}

function getReferencesForPrintSingleLineTextSnippet(references: ContentReferences) {
    // This function is mostly for the server. We're ok ignoring realtime updates in
    // Open Graph metadata.
    /* eslint-disable cyberworlds/no-model-initial-data */
    return {
        getAccountIfExists: (accountId: AccountId) => {
            const account = references.accountById.get(accountId);
            if (!account) return null;
            if ("initialData" in account) return account.initialData;
            return account;
        },
        getSearchEntityIfExists: (entityId: SearchMentionEntityId) => {
            const entity = references.searchEntityById.get(entityId);
            if (!entity) return null;
            if (entity.isPrivate) return entity;

            const entityData = entity.entity.initialData;
            const author = getAuthorFromSearchEntityIfExists(entityData);

            return {
                isPrivate: false as const,
                title: entityData.title,
                getAuthorData: author ? () => author.initialData : null,
            };
        },
        getFileIfExists: (fileId: FileId) =>
            references.fileById?.get(fileId)?.file.initialData ?? null,
    };
    /* eslint-enable cyberworlds/no-model-initial-data */
}
