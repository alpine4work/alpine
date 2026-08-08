import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexTypeFlattenedKeysType,
    OpensearchIndexTypeStoredFieldsType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {SearchEntityKeywordIndexDocType} from "~/server/search/data/index/internal/search_entity_index_doc.js";
import {searchEntityKeywordIndexRefreshIntervalMs} from "~/server/search/data/table/search_entity_actions.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertNotAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Special `SearchEntityId` used by the OpenSearch keyword index.
 *
 * The only change we make is `Account:` entity IDs need to append the `SpaceId`.
 * Since IDs in OpenSearch need to be globally unique (two spaces may live on the
 * same shard). An `AccountId` may be a member of multiple spaces and we need to
 * index a separate `AccountId` search entity for each space we're in. That means
 * we need an OpenSearch ID for accounts that includes the `SpaceId` so its unique
 * for each account/space pair. We add the `SpaceId` to the end with a `~`. The
 * convention in `SearchEntityId` normally is to separate parts with a dash so we
 * use a `~` to show the `SpaceId` isn't a part of the base `SearchEntityId`.
 */
export type SearchEntityIdForKeywordIndex =
    | Exclude<SearchDynamicEntityId, `Account:${AccountId}`>
    | `Account:${AccountId}~${SpaceId}`;

// Double check that `Account:${AccountId}` isn't allowed. We must add the
// `SpaceId`.
assertNotAssignableTypes<`Account:${AccountId}`, SearchEntityIdForKeywordIndex>();

export function intoSearchEntityIdForKeywordIndex(
    spaceId: SpaceId,
    entityId: SearchDynamicEntityId,
): SearchEntityIdForKeywordIndex {
    if (entityId.startsWith("Account:")) {
        return `${entityId as `Account:${AccountId}`}~${spaceId}`;
    } else {
        return entityId as Exclude<SearchDynamicEntityId, `Account:${AccountId}`>;
    }
}

export function fromSearchEntityIdForKeywordIndex(
    entityId: SearchEntityIdForKeywordIndex,
): SearchDynamicEntityId {
    if (entityId.startsWith("Account:")) {
        return assertExists(entityId.split("~")[0]) as `Account:${AccountId}`;
    } else {
        return entityId as Exclude<SearchDynamicEntityId, `Account:${AccountId}`>;
    }
}

// IMPORTANT: Access to this index should be exposed through narrowly scoped
// functions in the search index package. Like how we organize DynamoDB tables,
// this keeps writes to the index controlled instead of sprawling around the
// codebase.
export const SearchEntityKeywordIndex = new OpensearchIndex<
    SpaceId,
    SearchEntityIdForKeywordIndex,
    OpensearchIndexTypeType<typeof SearchEntityKeywordIndexDocType>,
    OpensearchIndexTypeFlattenedKeysType<typeof SearchEntityKeywordIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntityKeywordIndexDocType>
>(SearchEntityKeywordIndexDocType, {
    name: "search_entity_keywords",
    numberOfShards: 4,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    refreshInterval: `${assertInteger(searchEntityKeywordIndexRefreshIntervalMs / 1000)}s`,

    // Basically every query to this index will filter to a specific `SpaceId`. We may
    // have specialized queries (e.g. account name auto-complete) that filter to a
    // specific entity `type` as well.
    sort: [{field: "spaceId"}, {field: "type"}],

    // Disabling the source field is dangerous! It saves disk space but disables a lot
    // of useful features. From the [ElasticSearch docs][1]:
    //
    // 1. The `update`, `update_by_query`, and `reindex` APIs.
    // 2. On the fly highlighting.
    // 3. The ability to reindex from one ElasticSearch index to another, either to
    //    change mappings or analysis, or to upgrade an index to a new major version.
    // 4. The ability to debug queries or aggregations by viewing the original document
    //    used at index time.
    // 5. Potentially in the future, the ability to repair index corruption
    //    automatically.
    //
    // For 3 and 5 we can reindex by scanning our source tables for search entities.
    // This is probably safer than reindexing based on what's in OpenSearch.
    //
    // For 1 all we need is some stored fields (like `version`) to perform updates in
    // application code.
    //
    // For 4 we don't have a great alternative. We'll need to find other means of
    // debugging.
    //
    // For 2 we believe highlighting should still work if the field we're highlighting
    // is a stored field. Highlighting is the main feature we must keep.
    //
    // Given how big the search index will be, we believe the space savings of not
    // storing the `_source` field will be important for us.
    //
    // [1]:
    //     https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-source-field.html#disable-source-field
    disableSourceField: true,
});

function assertInteger(value: number): number {
    assert(Number.isInteger(value));
    return value;
}
