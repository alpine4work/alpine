import {intoEffectiveAccessPolicy} from "~/server/access/into_effective_access_policy.js";
import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {OpensearchDeleteDocCommand} from "~/server/opensearch/opensearch_client.js";
import {
    SearchEntityIndexAccessPolicy,
    SearchEntityIndexDefaultGrantType,
} from "~/server/search/data/index/internal/search_entity_index_doc.js";
import {
    type SearchEntityIdForKeywordIndex,
    SearchEntityKeywordIndex,
} from "~/server/search/data/index/internal/search_entity_keyword_index.js";
import type {AccessPolicy, EffectiveAccessPolicy} from "~/shared/access/access_policy.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import type {DatabaseTableId, SpaceId} from "~/shared/id/types/id_types.js";

export async function indexDatabaseTableSearchEntity(
    context: ServerActionContext,
    {
        spaceId,
        tableId,
        name,
        accessPolicy,
        isDeleted,
    }: {
        spaceId: SpaceId;
        tableId: DatabaseTableId;
        name: string | null;
        accessPolicy: AccessPolicy;
        isDeleted: boolean;
    },
): Promise<void> {
    const id: SearchEntityIdForKeywordIndex = `DatabaseTable:${tableId}`;

    if (isDeleted) {
        await context.opensearch.bulk([
            new OpensearchDeleteDocCommand(SearchEntityKeywordIndex, spaceId, id),
        ]);
        return;
    }

    const existing = await context.opensearch.getDocWithoutSourceIfExists(
        SearchEntityKeywordIndex,
        spaceId,
        id,
        {storedFields: []},
    );
    const now = new Date();
    const effectiveAccessPolicy = await intoEffectiveAccessPolicy(context, accessPolicy, {
        consistency: "StrongWithinCache",
    });

    await context.opensearch.indexDocIfVersion(SearchEntityKeywordIndex, spaceId, {
        id,
        version: existing?.version ?? null,
        spaceId,
        type: "DatabaseTable",
        createdTime: null,
        lastUpdatedTime: now,
        lastReadStartTime: now,
        dueDate: null,
        hasEmbeddingChunks: false,
        accessPolicy: intoSearchEntityIndexAccessPolicy(effectiveAccessPolicy),
        dependencyIds: [],
        title: name,
        titleVersion: null,
        body: null,
        tags: [],
        media: null,
        creatorId: null,
        majorContributorIds: [],
        anyContributorIds: [],
        assigneeId: null,
        openness: null,
        activeness: null,
        priority: null,
    });
}

function intoSearchEntityIndexAccessPolicy(
    accessPolicy: EffectiveAccessPolicy,
): SearchEntityIndexAccessPolicy {
    const defaultGrantType: SearchEntityIndexDefaultGrantType | null =
        accessPolicy.defaultGrant !== null ? "Space" : null;

    return {
        accountGrantAccountIds:
            defaultGrantType !== null ? emptySet : new Set(accessPolicy.accountGrantById.keys()),
        defaultGrantType,
        urlGrantLevel: accessPolicy.urlGrant?.level ?? null,
    };
}
