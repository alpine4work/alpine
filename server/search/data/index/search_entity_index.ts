import murmurhash from "murmurhash";
import {Node} from "prosemirror-model";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {getBotAccessPolicy} from "~/server/access/get_bot_access_policy.js";
import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {getChatDefinitionIfPossible} from "~/server/chat/data/get_chat_definition.js";
import {getChatSearchEntityContributorIds} from "~/server/chat/data/get_chat_search_entity_contributor_ids.js";
import {
    getContentReferencesForServerPrintSingleLineTextSnippet,
    printContentSingleLineTextSnippetForServer,
} from "~/server/content/print_content_single_line_text_snippet_for_server.js";
import {
    ServerAccountActionContextModules,
    ServerActionContext,
    ServerActionContextModules,
    ServerBotActionContext,
    ServerSessionActionContext,
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {getDocumentPreviewIfPossible} from "~/server/documents/data/documents_actions.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getChannelIfPossible} from "~/server/forum/data/get_channel.js";
import {getChannelPreviewIfPossible} from "~/server/forum/data/get_channel_preview.js";
import {getPostContentAndChannelPreviewIfPossible} from "~/server/forum/data/get_post_content_and_channel_preview.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";
import {
    OpensearchClient,
    OpensearchClientDocVersion,
    OpensearchClientDocWithIdAndVersion,
    OpensearchDeleteDocCommand,
    OpensearchGetDocWithoutSourceCommand,
    OpensearchIndexDocWithoutIdCommand,
} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {
    OpensearchIndex,
    OpensearchIndexDocType,
    OpensearchIndexFlattenedKeysType,
} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexTypeFlattenedKeysType,
    OpensearchIndexTypeStoredFieldsType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {
    OpensearchQueryClause,
    OpensearchQueryValue,
} from "~/server/opensearch/opensearch_query_clause.js";
import {
    IndexSearchEntityDependentsJobDescription,
    IndexSearchEntityEmbeddingChunksJobDescription,
    IndexSearchEntityJobDescription,
} from "~/server/search/core/index_search_entity_job_description.js";
import {SearchEntityDependencyId} from "~/server/search/core/search_entity_dependency_id.js";
import {getSearchEntityDependencyIdsAffectedByUpdate} from "~/server/search/core/search_entity_update.js";
import {
    SearchEntityEmbeddingChunk,
    getSearchEntity,
    getSearchRoomChatEntityMedia,
    sortSearchDirectChatEntityAccountIds,
} from "~/server/search/data/index/internal/get_search_entity.js";
import {parseSearchContent} from "~/server/search/data/index/internal/parse_search_content.js";
import {
    SearchNaturalLanguageFilter,
    parseSearchNaturalLanguageQuery,
} from "~/server/search/data/index/internal/parse_search_natural_language_query.js";
import {
    prepareSearchDirectChatEntityTitleForResult,
    searchChatEntityResultTitlePreviewAccountCount,
} from "~/server/search/data/index/internal/prepare_search_chat_entity_title_for_result.js";
import {printSearchNaturalLanguageFilter} from "~/server/search/data/index/internal/print_search_natural_language_filter.js";
import {
    SearchEntityEmbeddingChunkIndexDocType,
    SearchEntityIndexActivenessType,
    SearchEntityIndexActivenessTypeIntegerMapping,
    SearchEntityIndexDefaultGrantType,
    SearchEntityIndexDefaultGrantTypeIntegerMapping,
    SearchEntityIndexOpennessType,
    SearchEntityIndexOpennessTypeIntegerMapping,
    SearchEntityIndexPriorityType,
    SearchEntityIndexPriorityTypeIntegerMapping,
    SearchEntityKeywordIndexDoc,
    SearchEntityKeywordIndexDocType,
} from "~/server/search/data/index/internal/search_entity_index_doc.js";
import {SearchEntityMedia} from "~/server/search/data/index/internal/search_entity_media.js";
import {
    getPossiblyStaleChannelSearchAffinityEntityIds,
    getPossiblyStaleTaskCollectionSearchAffinityEntityIds,
    internalDangerouslyGetSpaceChannelSearchAffinityEntities,
    internalDangerouslyGetSpaceTaskCollectionSearchAffinityEntities,
    internalGetSearchAffinityEntities,
    internalGetSearchFavoriteEntities,
    internalGetUnorderedSearchAffinityEntitiesWithStrongReadConsistency,
    scheduleIndexSearchEntityEmbeddingChunksJob,
    searchEntityEmbeddingChunkIndexRefreshIntervalMs,
    searchEntityKeywordIndexRefreshIntervalMs,
    searchEntityKeywordIndexWaitForRefreshDelayMs,
    withIndexSearchEntityEmbeddingChunksJobLock,
} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {
    authorizeSpaceAccess,
    authorizeSpaceAccessIfPossible,
} from "~/server/spaces/authorize_space_access.js";
import {getAccount, getAccountIfExists} from "~/server/spaces/get_account.js";
import {getAccountOrDangerouslyGetStubWithoutAuthorization} from "~/server/spaces/get_account_or_dangerously_get_stub_without_authoriztion.js";
import {getSpaceAccount} from "~/server/spaces/get_space_account.js";
import {getSpaceAccountNameSearchIndex} from "~/server/spaces/get_space_account_name_search_index.js";
import {getSpaceAccountSettings} from "~/server/spaces/get_space_account_settings.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {spaceWelcomePackageSearchEntityMaxCount} from "~/server/spaces/space_welcome_package_search_entity_max_count.js";
import {
    getTaskCollectionSearchResultBodyTextSnippetIfPossible,
    getTaskCollectionSearchResultIfPossible,
} from "~/server/tasks/data/task_table.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {
    AccessPolicyAccountGrantWithoutGeneration,
    AccessPolicyDefaultGrantWithoutGeneration,
    AccessPolicyUrlGrant,
} from "~/shared/access/access_policy.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {
    ContentReferences,
    ContentReferencesSearchEntity,
    emptyContentReferences,
} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {printContentSingleLineTextSnippetPreservingMarks} from "~/shared/content/print_content_single_line_text_snippet.js";
import {ContextBatcher} from "~/shared/context/batch_context_module.js";
import {CacheContextModule, ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ChannelModel, ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {
    createPostSearchEntityTitleWithAlreadySnippedContent,
    getPostSearchEntityTitleContentSnippet,
} from "~/shared/forum/create_post_search_entity_title.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertNotAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {addToIterable} from "~/shared/helpers/iterable/add_to_iterable.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {escapeRegExp} from "~/shared/helpers/string/escape_reg_exp.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {JsonScalarValue, JsonValue} from "~/shared/helpers/types/json_value.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {assertId, isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    SpaceId,
    TaskCollectionId,
} from "~/shared/id/types/id_types.js";
import {OpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {
    SearchAffinityEntityId,
    SearchDynamicEntityId,
    SearchDynamicEntityIdObject,
    SearchEntityId,
    SearchMentionEntityId,
    getSearchMentionEntityTypes,
    isSearchMentionEntityId,
    parseSearchDynamicEntityId,
    parseSearchMentionEntityId,
    printSearchDynamicEntityId,
} from "~/shared/search/search_entity_id.js";
import {SearchEntityMediaModel} from "~/shared/search/search_entity_media_model.js";
import {
    SearchAffinityEntityModel,
    SearchEntityModel,
    isSearchEntityModelId,
} from "~/shared/search/search_entity_model.js";
import {
    SearchAffinityEntityResultModel,
    SearchEntityResultModel,
    SearchFavoriteEntityResultModel,
} from "~/shared/search/search_entity_result_model.js";
import {SearchEntityTitleVersion} from "~/shared/search/search_entity_title_version.js";
import {SearchOptions, standardSearchOptions} from "~/shared/search/search_options.js";
import {searchStaticEntityById} from "~/shared/search/search_static_entity.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {searchShortcutFavoriteEntityMaxCount} from "~/shared/spaces/space_account_settings.js";
import {getTaskCollectionSearchEntityBase} from "~/shared/tasks/get_task_collection_search_entity_base.js";
import {getTaskSearchEntityBase} from "~/shared/tasks/get_task_search_entity_base.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

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

function intoSearchEntityIdForKeywordIndex(
    spaceId: SpaceId,
    entityId: SearchDynamicEntityId,
): SearchEntityIdForKeywordIndex {
    if (entityId.startsWith("Account:")) {
        return `${entityId as `Account:${AccountId}`}~${spaceId}`;
    } else {
        return entityId as Exclude<SearchDynamicEntityId, `Account:${AccountId}`>;
    }
}

function fromSearchEntityIdForKeywordIndex(
    entityId: SearchEntityIdForKeywordIndex,
): SearchDynamicEntityId {
    if (entityId.startsWith("Account:")) {
        return entityId.split("~")[0]! as `Account:${AccountId}`;
    } else {
        return entityId as Exclude<SearchDynamicEntityId, `Account:${AccountId}`>;
    }
}

/**
 * Our "search entity index" is actually two OpenSearch indexes.
 * `SearchEntityKeywordIndex` and `SearchEntitySemanticIndex`.
 *
 * - `SearchEntityKeywordIndex` indexes the entity for keyword search. The entire
 *   document body and title is put into a text reverse index so we can quickly
 *   find the documents containing a word.
 *
 * - `SearchEntitySemanticIndex` indexes the entity for semantic search. The
 *   document body is split into chunks and sent to our language model ([Cohere][1]
 *   in production) for embedding. The returned embedding vectors are stored in an
 *   HNSW graph.
 *
 * Why do we keep these two indexes separate? A search entity is represented by a
 * single doc. The reason: isolation. Isolation makes sure the performance of one
 * doesn't affect the other. We want keyword search to be really fast, we don't
 * want embedding data slowing keyword search/indexing down. We're ok with semantic
 * search being a little slower.
 *
 * Even if the data for both keyword search and semantic search were in the same
 * index, we still need to issue two separate queries and merge the results out of
 * OpenSearch. Since OpenSearch provides no means to merge the query results. Even
 * if it did, because keyword search is faster we probably want to execute the
 * queries separately anyway so we can return a response to the user faster.
 * Isolation then feels useful in case semantic search is slow or failing then
 * keyword search will be unaffected.
 *
 * Separating the two indexes also allows us to use [index sorting][2] for the
 * keyword index. (The semantic index uses a `nested` field which doesn't work with
 * index sorting.) Index sorting is an [important optimization][3] for queries that
 * filter to a `SpaceId` since we can skip scanning entire Lucene internal segments
 * that don't match the `SpaceId`.
 *
 * [1]: https://cohere.com
 * [2]:
 *     https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-index-sorting.html
 * [3]: https://www.elastic.co/blog/index-sorting-elasticsearch-6-0
 */
// IMPORTANT: Don't export this. All access to the index should be exposed through
// functions in this file. Like how we organize DynamoDB tables. By putting all the
// logic around this index in one file it allows developers to carefully control
// how data is written to this index. Instead of updates sprawling out around the
// codebase.
const SearchEntityKeywordIndex = new OpensearchIndex<
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

// IMPORTANT: Don't export this. All access to the index should be exposed through
// functions in this file. Like how we organize DynamoDB tables. By putting all the
// logic around this index in one file it allows developers to carefully control
// how data is written to this index. Instead of updates sprawling out around the
// codebase.
const SearchEntityEmbeddingChunkIndex = new OpensearchIndex<
    SpaceId,
    string,
    OpensearchIndexTypeType<typeof SearchEntityEmbeddingChunkIndexDocType>,
    OpensearchIndexTypeFlattenedKeysType<typeof SearchEntityEmbeddingChunkIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntityEmbeddingChunkIndexDocType>
>(SearchEntityEmbeddingChunkIndexDocType, {
    name: "search_entity_embedding_chunks",
    numberOfShards: 4,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    refreshInterval: `${assertInteger(searchEntityEmbeddingChunkIndexRefreshIntervalMs / 1000)}s`,

    // Basically every query to this index will filter to a specific `SpaceId`. We may
    // have specialized queries (e.g. account name auto-complete) that filter to a
    // specific entity `type` as well.
    sort: [{field: "spaceId"}, {field: "entity.type"}],

    // We disable the source field here for the same reasoning as
    // `SearchEntityKeywordIndex`. It's particularly important we disable the source
    // field here since we duplicate the `accessPolicy` in every nested document. It
    // would be inefficient to store the full source.
    disableSourceField: true,
});

function assertInteger(value: number): number {
    assert(Number.isInteger(value));
    return value;
}

// Double check we've only stored fields we need.
assertEqualTypes<
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntityKeywordIndexDocType>,
    {
        createdTime: Date;
        lastUpdatedTime: Date;
        dueDate: Date;
        "accessPolicy.accountGrantAccountIds": AccountId;
        "accessPolicy.defaultGrantType": SearchEntityIndexDefaultGrantType;
        "accessPolicy.urlGrantLevel": AccessPolicyUrlGrant["level"];
        lastReadStartTime: Date;
        hasEmbeddingChunks: boolean;
        title: string;
        titleVersion: SearchEntityTitleVersion;
        body: string;
        media: SearchEntityMedia;
        openness: SearchEntityIndexOpennessType;
        activeness: SearchEntityIndexActivenessType;
        priority: SearchEntityIndexPriorityType;
    }
>();

// Double check we've only stored fields we need.
assertEqualTypes<
    OpensearchIndexTypeStoredFieldsType<typeof SearchEntityEmbeddingChunkIndexDocType>,
    {
        "entity.id": SearchDynamicEntityId;
        "entity.title": string;
        "entity.titleVersion": SearchEntityTitleVersion;
        "entity.media": SearchEntityMedia;
        text: string;
        textHash: number;
        preambleEndIndex: number;
        "vector.allMiniLmL6V2": number;
        "vector.cohereEmbedEnglishV3": number;
    }
>();

/**
 * Allow using the search entity indexes directly in Jest unit tests.
 */
export function getSearchEntityIndexesForTest() {
    assert(process.env.NODE_ENV === "test");
    return {SearchEntityKeywordIndex, SearchEntityEmbeddingChunkIndex};
}

/**
 * Deploy our search indexes to production.
 *
 * May only be called in a production environment. Should only be called by our
 * deployment scripts.
 */
export async function deploySearchEntityIndexes(
    tracer: TracerBase,
    client: OpensearchClient,
    signal: AbortSignal,
) {
    assert(process.env.NODE_ENV === "production");

    await runAllPromises([
        client.deployIndex(tracer, SearchEntityKeywordIndex, signal),
        client.deployIndex(tracer, SearchEntityEmbeddingChunkIndex, signal),
    ]);
}

/**
 * Manually refresh the search entity keyword index in tests. This means any
 * changes to the index will be available when searching.
 */
export function refreshSearchEntityKeywordIndexForTest(
    context: Context<{tracer: TracerContextModule; opensearch: OpensearchContextModule}>,
) {
    assert(import.meta.jest);

    return context.opensearch.refresh(SearchEntityKeywordIndex);
}

/*
 * After parsing queries, some values need to be mapped to their opensearch
 * enums. This function does that conversion, or just returns the raw values
 * if no mapping is needed.
 */
function mapNaturalLanguageFilterToOpensearchValue(
    flattenedKey: OpensearchIndexFlattenedKeysType<typeof SearchEntityKeywordIndex>,
    values: ReadonlyArray<JsonValue>,
) {
    switch (flattenedKey) {
        case "priority":
            return values.map(value =>
                value !== null
                    ? SearchEntityIndexPriorityTypeIntegerMapping.into(
                          value as SearchEntityIndexPriorityType,
                      )
                    : null,
            );
        case "openness":
            return values.map(value =>
                value !== null
                    ? SearchEntityIndexOpennessTypeIntegerMapping.into(
                          value as SearchEntityIndexOpennessType,
                      )
                    : null,
            );
        case "activeness":
            return values.map(value =>
                value !== null
                    ? SearchEntityIndexActivenessTypeIntegerMapping.into(
                          value as SearchEntityIndexActivenessType,
                      )
                    : null,
            );
        default:
            return values;
    }
}

/**
 * The minimum number of tokens a chunk needs for us to embed it.
 *
 * It's wasteful to embed small messages like "Nice!" or "Ok!". Embeddings of small
 * content can also pollute search results as they may be a closer topic match to a
 * search query but do not include detail the user wants to see. [Cohere's v3
 * embedding models][1] (which we use in production) defend against this by
 * considering the content's quality, but it's still good for us to throw out
 * chunks without important meaning.
 *
 * Small chunks can still be found with keyword search.
 *
 * How we pick this value: We want embedding chunks to have more than two sentences
 * worth of content. Sentences are usually between 15-20 words ([source][2]) and a
 * word is typically 1-3 tokens ([source][3]). This means two sentences most of the
 * time fall in the range of 15-60 tokens. 35 is a nice round number near the
 * middle of this range.
 *
 * [1]: https://txt.cohere.com/introducing-embed-v3/
 * [2]: https://languagetool.org/insights/post/sentence-length
 * [3]: https://docs.cohere.com/docs/tokens
 */
const minEmbeddingChunkTokenCount = 35;

/**
 * Always index these search entity types even if their embedding chunk token count
 * is below `minEmbeddingChunkTokenCount`.
 */
function alwaysEmbedSearchEntityType(type: SearchDynamicEntityIdObject["type"]): boolean {
    switch (type) {
        // Always index channels and task collections since they're created rarely and will
        // usually be meaningful even if their search entity doesn't immediately have much
        // content.
        case "Chat":
        case "Channel":
        case "TaskCollection":
            return true;

        case "Account":
        case "Document":
        case "DocumentComment":
        case "Post":
        case "PostComment":
        case "ChatMessage":
        case "Task":
        case "TaskComment":
            return false;

        default:
            throw exhaustive(type);
    }
}

export const processIndexSearchEntityDependentsJobTestCounter =
    new TestCounter<SearchEntityDependencyId>();

/**
 * Indexes any entity in our system, making its content available for searching.
 * This function is idempotent, running it multiple times will produce the same
 * result.
 *
 * All searchable objects in our system can be converted to a `SearchEntity`
 * object. Which includes the object's text content, dependencies, and access
 * policy (for evaluating permissions). We also split the object's text content
 * into chunks of reasonable size for our LLM to embed to a vector representation.
 * In production we use [Cohere][1] for embeddings. In development we use a small
 * model that's not very good but can run on a personal computer.
 *
 * Our indexing steps are as follows:
 *
 * 1. Convert the object into a `SearchEntity`
 * 2. Schedule an update to all other entities which have a dependency on this
 *    entity (the `IndexSearchEntityDependents` job, which queues more
 *    `IndexSearchEntity` jobs)
 * 3. If the `SearchEntity` has embedding chunks, schedule a job
 *    (`IndexSearchEntityEmbeddingChunks`) for later that'll save the
 *    `SearchEntity`'s chunks into our vector index
 *    (`SearchEntityEmbeddingChunkIndex`)
 * 4. Save the `SearchEntity` to our keyword index (`SearchEntityKeywordIndex`)
 *
 * The guarantee provided by this function is: If this function completes
 * successfully, any updates committed before the time the job was queued
 * (`jobSendTime`) will be reflected in the search index.
 *
 * Make sure you only queue an indexing job AFTER you've committed your update.
 * Otherwise it may not be read by the job. Some notes on consistency:
 *
 * - When reading from DynamoDB, we make sure to use strong read consistency to
 *   guarantee we read the latest committed data.
 *
 * - For a system like tasks, we read from `TaskRealtimeService` which maintains
 *   up-to-date task object representations. That means we need to wait for actions
 *   to be applied in `TaskRealtimeService` before we can queue an indexing job. If
 *   we try to queue an indexing job after actions are committed to
 *   `TaskActionTable` and before they're applied in `TaskRealtimeService` we may
 *   miss some updates while indexing since we read from `TaskRealtimeService`.
 *
 * [1]: https://cohere.com
 */
export async function processIndexSearchEntityJob(
    context: ServerSystemActionContext,
    job: IndexSearchEntityJobDescription,
    jobStartTime: Date,
    span: Pick<TracerSpan, "addData">,
) {
    const entityId = printSearchDynamicEntityId(job.update);

    // A time after the update we're trying to process with this indexing job. We use
    // this to check if the indexed entity has already been read after this time, if it
    // has then we don't need to read it again!
    //
    // So the closer the time can get to the update, the better, since it allows us to
    // noop in more cases. That's why we use `job.parentJobStartTime` when available.
    // If we're a child job (probably because we're scheduled by dependent updates) as
    // long as the entity was read after the parent job then we don't need to read it
    // again.
    const readAfterTime = job.parentJobStartTime ?? jobStartTime;

    let hasAlreadyAttempted = false;
    let hasScheduledIndexDependentsJob = false;
    let hasScheduledIndexEmbeddingChunksJob = false;

    await retryWithExponentialBackoff(async retry => {
        const isInitialAttempt = !hasAlreadyAttempted;
        hasAlreadyAttempted = true;

        if (!isInitialAttempt) {
            // On second attempt, use an empty cache when we re-run the action. We're usually
            // retrying because there was a version conflict when we tried to write the
            // OpenSearch doc with another process concurrently writing the doc at the same
            // time.
            //
            // When we retry, we don't want to use cached values because they may be outdated!
            // Instead, we want to read everything fresh with strong consistency. Given we use
            // `StrongWithinCache` consistency in `getSearchEntity()` we don't want to reuse
            // data from a previous attempt.
            //
            // So create a new cache on repeat attempts of this job. (`DynamoContextModule`'s
            // `retryTransaction()` loop does something similar.)
            context = context.clone({
                cache: CacheContextModule.new(),
            });
        }

        const actualOldDocForKeywordIndex = await context.opensearch.getDocWithoutSourceIfExists(
            SearchEntityKeywordIndex,
            job.spaceId,
            intoSearchEntityIdForKeywordIndex(job.spaceId, entityId),
            {
                storedFields:
                    job.update.type !== "Post"
                        ? ["lastUpdatedTime", "lastReadStartTime", "hasEmbeddingChunks"]
                        : // If we're indexing a `Post` then load the `title`. We compute the `Post`'s
                          // `title` during indexing so in order to know whether we need to re-index
                          // dependents we need the old `title` value.
                          ["lastUpdatedTime", "lastReadStartTime", "hasEmbeddingChunks", "title"],
            },
        );

        const oldDocForKeywordIndex = actualOldDocForKeywordIndex
            ? {
                  version: actualOldDocForKeywordIndex.version,
                  lastUpdatedTime: assertExists(
                      actualOldDocForKeywordIndex.fields.lastUpdatedTime?.[0],
                  ),
                  lastReadStartTime: assertExists(
                      actualOldDocForKeywordIndex.fields.lastReadStartTime?.[0],
                  ),
                  hasEmbeddingChunks:
                      actualOldDocForKeywordIndex.fields.hasEmbeddingChunks?.[0] ?? false,
                  titleIfPost: actualOldDocForKeywordIndex.fields.title?.[0] ?? null,
              }
            : null;

        // Is the doc currently in the search index sufficient for this indexing job? If
        // true we can end the job without needing to save `newDoc` to the index.
        //
        // It is sufficient if the data in the index was read AFTER the job was sent to our
        // queue. That means `oldDoc` includes the update our job wants to index.
        //
        // Useful optimization when there are multiple updates to the same entity being
        // processed in parallel. Or when jobs updating the same entity are delayed.
        //
        // We only need to check the keyword doc. If the keyword doc is sufficient then the
        // job which indexed it should have also indexed an embedding doc. If it did not
        // index an embedding doc, either an embedding doc doesn't exist or there was an
        // error and the job will be retried.
        const isOldDocSufficient =
            !!oldDocForKeywordIndex &&
            isDateDefinitelyLessThanWithUncertaintyWindow(
                readAfterTime,
                oldDocForKeywordIndex.lastReadStartTime,
            );

        if (isOldDocSufficient) {
            span.addData({common: {didNothing: true}});
            return;
        }

        await runAllPromises([update(retry, oldDocForKeywordIndex), scheduleUpdateDependents()]);
    });

    async function update(
        retry: (error?: unknown) => never,
        oldDocForKeywordIndex: {
            version: OpensearchClientDocVersion | null;
            lastUpdatedTime: Date;
            lastReadStartTime: Date;
            hasEmbeddingChunks: boolean;
            titleIfPost: string | null;
        } | null,
    ) {
        // We use the Cohere `embed-english-v3.0` model's tokenizer to chunk our content.
        // That's because it's the main model we use in production for embeddings. In
        // development we embed with a smaller model we can run locally
        // (`all-MiniLM-L6-v2`) but we standardize on Cohere's ideal chunk size to make
        // debugging chunk generation easier.
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const readStartTime = new Date();
        const additionalWriteActions: Array<(context: ServerSystemActionContext) => Promise<void>> =
            [];

        const {dependencyIds, entity} = await getSearchEntity(context, job.update, {
            tokenizer,
            registerAdditionalWrite: action => additionalWriteActions.push(action),
        });

        // The new updated time should:
        //
        // - Always be bigger than `createdTime`
        // - Always be bigger than the last `lastUpdatedTime`
        // - Use `jobStartTime` since that more accurately represents when the update
        //   happened rather than the current time (since the job may have been delayed)
        const newLastUpdatedTimeCandidates: Array<number> = [];

        if (entity.createdTime) newLastUpdatedTimeCandidates.push(entity.createdTime.getTime());

        if (oldDocForKeywordIndex)
            newLastUpdatedTimeCandidates.push(oldDocForKeywordIndex.lastUpdatedTime.getTime());

        // We don't update `lastUpdatedTime` to the latest time if there are no updated
        // traits. Which happens when creating entities, re-indexing an entity after a
        // dependency changed, and indexes triggered by a migration.
        //
        // If `updatedTraits` is `None` that means the underlying entity didn't actually
        // update and we're indexing for some other reason.
        if (
            job.update.updatedTraits.type !== "None" ||
            // If there are no other candidate times, use `jobStartTime` as a fallback.
            newLastUpdatedTimeCandidates.length === 0
        ) {
            newLastUpdatedTimeCandidates.push(jobStartTime.getTime());
        }

        const newLastUpdatedTime = new Date(Math.max(...newLastUpdatedTimeCandidates));

        const majorContributorIds = new Set<AccountId>();
        const anyContributorIds = new Set<AccountId>();

        if (entity.creatorId !== null) {
            majorContributorIds.add(entity.creatorId);
            anyContributorIds.add(entity.creatorId);
        }

        for (const [contributorId, type] of entity.contributorIds) {
            if (type === "Major") {
                majorContributorIds.add(contributorId);
                anyContributorIds.add(contributorId);
            } else {
                anyContributorIds.add(contributorId);
            }
        }

        const newDocForKeywordIndex: OpensearchClientDocWithIdAndVersion<
            SearchEntityIdForKeywordIndex,
            SearchEntityKeywordIndexDoc
        > = {
            id: intoSearchEntityIdForKeywordIndex(job.spaceId, entityId),
            version: oldDocForKeywordIndex?.version ?? null,
            spaceId: job.spaceId,
            type: job.update.type,
            createdTime: entity.createdTime,
            lastUpdatedTime: newLastUpdatedTime,
            lastReadStartTime: readStartTime,
            dueDate: entity.dueDate?.toDate("UTC") ?? null,
            hasEmbeddingChunks: entity.embeddingChunks.some(
                embeddingChunk =>
                    embeddingChunk.tokenCountWithoutPreamble >= minEmbeddingChunkTokenCount ||
                    alwaysEmbedSearchEntityType(job.update.type),
            ),
            accessPolicy: entity.accessPolicy,
            dependencyIds: Array.from(dependencyIds),
            title: entity.title,
            titleVersion: entity.titleVersion,
            // Remove `<table>` HTML from body. We don't want the search "table" to match all
            // content with a table. Though that might make sense to a user a search for
            // "tbody" wouldn't make sense if it matched all content with tables.
            body:
                entity.body?.replaceAll(/(?<!\\)<\/?(?:table|thead|tbody|tr|td|th)>/g, "") ?? null,
            tags: entity.tags,
            media: entity.media,
            creatorId: entity.creatorId,
            majorContributorIds: Array.from(majorContributorIds),
            anyContributorIds: Array.from(anyContributorIds),
            assigneeId: entity.assigneeId,
            openness: entity.openness,
            activeness: entity.activeness,
            priority: entity.priority,
        };

        await runAllPromises([
            // If the entity has some embedding chunks, then we need to index those chunks. If
            // the entity had some embedding chunks but no longer has those chunks we also need
            // to run our embedding chunk indexing job since we need to delete any existing
            // embedding chunks.
            newDocForKeywordIndex.hasEmbeddingChunks || oldDocForKeywordIndex?.hasEmbeddingChunks
                ? scheduleUpdateEmbeddingChunks()
                : null,

            // If `getSearchEntity()` declared any additional write actions then execute those
            // now.
            //
            // This is used, for example, by `getDocumentSearchEntity()`. Since we want to
            // update the document's content preview in DynamoDB at the same time we update it
            // in our OpenSearch index.
            //
            // We must execute the actions before `indexDocIfVersion()` to make sure these
            // actions execute reliably. Imagine executing the actions after
            // `indexDocIfVersion()` and `indexDocIfVersion()` passes but the additional write
            // action fails. When SQS re-runs the `IndexSearchEntity` job it'll early return
            // and NOT re-run our additional write actions since the `lastReadStartTime` of the
            // current doc in the keywords index is sufficient.
            additionalWriteActions.length > 0
                ? runAllPromises(additionalWriteActions.map(action => action(context)))
                : null,
        ]);

        await context.opensearch.indexDocIfVersion(
            SearchEntityKeywordIndex,
            job.spaceId,
            newDocForKeywordIndex,
            {retryVersionConflictError: retry},
        );
    }

    async function scheduleUpdateDependents() {
        if (hasScheduledIndexDependentsJob) return;
        hasScheduledIndexDependentsJob = true;

        const dependencyIds = getSearchEntityDependencyIdsAffectedByUpdate(job.update);
        if (dependencyIds.length === 0) return;

        // Wait for the index to refresh before querying dependents. We want to capture ALL
        // dependents created before the job started. There may be some dependents another
        // job saved that won't appear in a query until after the index refreshes.
        //
        // We may capture some dependents that were recently updated and have the latest
        // dependency data. That's ok since entity indexing is idempotent. We may even be
        // able to skip re-reading them when we check `lastReadStartTime`.
        if (!import.meta.jest) {
            await context.jobs.sendAndWait(
                {
                    type: "IndexSearchEntityDependents",
                    spaceId: job.spaceId,
                    update: job.update,
                    parentJobStartTime: job.parentJobStartTime ?? jobStartTime,
                },
                {
                    // Instead of calling `wait()` and blocking the job queue we schedule a new job
                    // with `delaySeconds`.
                    delaySeconds: searchEntityKeywordIndexWaitForRefreshDelayMs / 1000,
                },
            );
        } else {
            // In Jest tests, indexes need to be refreshed manually. Don't refresh manually in
            // production.
            await context.opensearch.refresh(SearchEntityKeywordIndex);

            await context.jobs.sendAndWait({
                type: "IndexSearchEntityDependents",
                spaceId: job.spaceId,
                update: job.update,
                parentJobStartTime: job.parentJobStartTime ?? jobStartTime,
            });
        }
    }

    async function scheduleUpdateEmbeddingChunks() {
        if (hasScheduledIndexEmbeddingChunksJob) return;
        hasScheduledIndexEmbeddingChunksJob = true;

        await scheduleIndexSearchEntityEmbeddingChunksJob(context, {
            spaceId: job.spaceId,
            entityId,
            readAfterTime,
        });
    }
}

/**
 * A continuation of `processIndexSearchEntityJob()`. Processes the dependents of a
 * search entity after a delay while we wait for the search index to refresh.
 *
 * Only `processIndexSearchEntityJob()` should schedule this job. See where
 * `processIndexSearchEntityJob()` sends a `IndexSearchEntityDependents` job.
 */
export async function processIndexSearchEntityDependentsJob(
    context: ServerSystemActionContext,
    job: IndexSearchEntityDependentsJobDescription,
) {
    const dependencyIds = getSearchEntityDependencyIdsAffectedByUpdate(job.update);
    if (dependencyIds.length === 0) return;

    for (const dependencyId of dependencyIds) {
        processIndexSearchEntityDependentsJobTestCounter.incrementForTest(dependencyId);
    }

    // Maximum search page size is 10k.
    const searchSize = 10_000;
    let afterCursor: ReadonlyArray<JsonScalarValue> | null = null;

    do {
        const {hits} = await context.opensearch.searchWithoutSource(
            SearchEntityKeywordIndex,
            job.spaceId,
            {
                size: searchSize,
                sort: ["_doc"],
                afterCursor: afterCursor ?? undefined,
                query: {
                    bool: {
                        filter: {
                            bool: {
                                must: [
                                    {
                                        term: {
                                            spaceId: new OpensearchQueryValue(job.spaceId),
                                        },
                                    },
                                    {
                                        terms: {
                                            dependencyIds: new OpensearchQueryValue(dependencyIds),
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        );

        await runAllPromises(
            hits.map(async hit => {
                // Confirm the job was added to the queue before exiting. It's ok to take the batch
                // delay performance hit when processing jobs.
                await context.jobs.sendAndWait({
                    type: "IndexSearchEntity",
                    spaceId: job.spaceId,
                    update: {
                        ...parseSearchDynamicEntityId(fromSearchEntityIdForKeywordIndex(hit.id)),
                        // Dependencies didn't update so we can skip reindexing transitive dependencies.
                        //
                        // This should also prevent infinite job cycles since this `IndexSearchEntity` job
                        // won't schedule a `IndexSearchEntityDependentsJob`.
                        updatedTraits: {type: "None"},
                    },
                    parentJobStartTime: job.parentJobStartTime,
                });
            }),
        );

        afterCursor = (
            hits.length > 0 ? assertExists(hits[hits.length - 1]!.cursor) : null
        ) as ReadonlyArray<JsonScalarValue> | null;

        // If we did not reach the pagination limit then don't query again for the next
        // page.
        if (hits.length < searchSize) afterCursor = null;
    } while (afterCursor !== null);
}

/**
 * Index a search entity in our vector search index. The entity is split into
 * chunks, those chunks are sent to an LLM to generate vector embeddings, and then
 * those embeddings go into OpenSearch.
 *
 * We only need to index the parts of the entity that changed. If we have a long
 * document, for example, we delete chunks that have been removed and insert new
 * chunks. If some part of the document was updated that usually translates into
 * deleting an old chunk for the section and inserting a new chunk for the section.
 *
 * Indexing search entities in our vector search index happens on a much slower
 * cadence than indexing search entities in our keyword search index. We throttle
 * this job so it only runs once every 5min (as of 2025-04-11) and we must wait at
 * least 3min (as of 2025-04-11) between job runs for the OpenSearch index to
 * refresh since we need to use the OpenSearch `/_search` endpoint to get the old
 * chunks we diff against.
 *
 * We also have a locking mechanism for this job. Only one process may run this job
 * for a given entity at a time. Otherwise we'd have wild, undefined, behavior if
 * two processes were trying to issue a bunch of OpenSearch deletes/inserts at the
 * same time.
 */
export async function processIndexSearchEntityEmbeddingChunksJob(
    context: Context<
        ServerSystemActionContextModules & {
            /**
             * A language model is optional in unit tests. But must be provided in production
             * and local developer environments.
             */
            languageModel?: LanguageModelContextModule;
        }
    >,
    job: IndexSearchEntityEmbeddingChunksJobDescription,
) {
    await withIndexSearchEntityEmbeddingChunksJobLock(context, job, async () => {
        // We use the Cohere `embed-english-v3.0` model's tokenizer to chunk our content.
        // That's because it's the main model we use in production for embeddings. In
        // development we embed with a smaller model we can run locally
        // (`all-MiniLM-L6-v2`) but we standardize on Cohere's ideal chunk size to make
        // debugging chunk generation easier.
        const tokenizer = await CohereEmbedEnglishV3LanguageTokenizer.get();

        const entityIdObject = parseSearchDynamicEntityId(job.entityId);

        const [{entity}, allOldChunks] = await runAllPromises([
            getSearchEntity(context, entityIdObject, {
                tokenizer,
                // We should have already performed any additional writes in our
                // `IndexSearchEntity` job.
                registerAdditionalWrite: noop,
            }),
            (async () => {
                const allHits: Array<{
                    id: string;
                    textHash: number;
                }> = [];

                const size = 500;
                let afterCursor: ReadonlyArray<JsonScalarValue> | null = null;

                // Paginate through all chunks for the entity.
                //
                // In order for this to work, search needs to read data written by the previous
                // `IndexSearchEntityEmbeddingChunks` job. This requires waiting for OpenSearch to
                // refresh the index. `withIndexSearchEntityEmbeddingChunksJobLock()` manages this
                // for us! Our locking function makes sure there's only one process updating the
                // embedding chunks index for an entity at any given time.
                do {
                    const {hits} = await context.opensearch.searchWithoutSource(
                        SearchEntityEmbeddingChunkIndex,
                        job.spaceId,
                        {
                            size,
                            sort: ["_doc"],
                            afterCursor: afterCursor ?? undefined,
                            storedFields: ["textHash"],
                            query: {
                                bool: {
                                    filter: [
                                        {
                                            term: {
                                                "entity.id": new OpensearchQueryValue(job.entityId),
                                            },
                                        },

                                        // NOTE(calebmer): Adding this `spaceId` filter even though we've already set
                                        // `job.spaceId` as the routing value in case we need to add an explicit filter to
                                        // trigger [OpenSearch sorted index optimizations][1].
                                        //
                                        // [1]:
                                        //     https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-index-sorting.html
                                        {term: {spaceId: new OpensearchQueryValue(job.spaceId)}},
                                    ],
                                },
                            },
                        },
                    );

                    for (const hit of hits) {
                        allHits.push({
                            id: hit.id,
                            textHash: assertExists(hit.fields.textHash?.[0]),
                        });
                    }

                    afterCursor = (
                        hits.length > 0 ? assertExists(hits[hits.length - 1]!.cursor) : null
                    ) as ReadonlyArray<JsonScalarValue> | null;

                    // If we did not reach the pagination limit then don't query again for the next
                    // page.
                    if (hits.length < size) afterCursor = null;
                } while (afterCursor !== null);

                return allHits;
            })(),
        ]);

        const oldChunksByTextHash = new Map<number, Array<{id: string; textHash: number}>>();

        for (const chunk of allOldChunks) {
            getOrSetDefaultMapValue(oldChunksByTextHash, chunk.textHash, () => []).push(chunk);
        }

        const newChunksByTextHash = new Map<number, Array<SearchEntityEmbeddingChunk>>();

        for (const chunk of entity.embeddingChunks) {
            // We don't want to embed small messages like "Ok!" so filter out chunks without
            // much content.
            //
            // When seeing if this chunk is too small for embedding, we ignore the preamble
            // added for context. We only want to measure the content's tokens.
            if (
                chunk.tokenCountWithoutPreamble < minEmbeddingChunkTokenCount &&
                !alwaysEmbedSearchEntityType(entityIdObject.type)
            ) {
                continue;
            }

            // `murmurhash` returns a positive 32-bit integer. Convert to a signed 32-bit
            // integer using the JavaScript bitwise operator `n | 0`.
            const textHash = murmurhash.v3(chunk.text) | 0;

            getOrSetDefaultMapValue(newChunksByTextHash, textHash, () => []).push(chunk);
        }

        const addNewChunks: Array<{
            textHash: number;
            chunk: SearchEntityEmbeddingChunk;
        }> = [];

        const deleteOldChunkIds: Array<string> = [];

        for (const [textHash, newChunks] of newChunksByTextHash) {
            const oldChunks = oldChunksByTextHash.get(textHash);
            oldChunksByTextHash.delete(textHash);

            if (!oldChunks) {
                // Add any new chunks.
                for (const newChunk of newChunks) {
                    addNewChunks.push({textHash, chunk: newChunk});
                }
            } else {
                // If there are more `newChunks` than `oldChunks`, add any additional `newChunks`.
                for (let i = oldChunks.length; i < newChunks.length; i++) {
                    const newChunk = newChunks[i]!;
                    addNewChunks.push({textHash, chunk: newChunk});
                }

                // If there are more `oldChunks` than `newChunks`, delete any remaining
                // `oldChunks`.
                for (let i = newChunks.length; i < oldChunks.length; i++) {
                    const oldChunk = oldChunks[i]!;
                    deleteOldChunkIds.push(oldChunk.id);
                }
            }
        }

        // Delete any remaining old chunks.
        for (const oldChunks of oldChunksByTextHash.values()) {
            for (const oldChunk of oldChunks) {
                deleteOldChunkIds.push(oldChunk.id);
            }
        }

        await runAllPromises([
            // Delete all the old chunks while we're generating embeddings for the new
            // chunks...
            (async () => {
                if (deleteOldChunkIds.length === 0) return;

                await context.opensearch.bulk(
                    deleteOldChunkIds.map(deleteOldChunkId => {
                        return new OpensearchDeleteDocCommand(
                            SearchEntityEmbeddingChunkIndex,
                            job.spaceId,
                            deleteOldChunkId,
                        );
                    }),
                );
            })(),

            // Generate embeddings for the new chunks and add them...
            (async () => {
                if (addNewChunks.length === 0) return;

                // Must provide a language model in the system context everywhere except Jest unit
                // tests. Since the language model can be big, we allow unit tests to exclude the
                // language model from their runfiles.
                if (!context.languageModel && !import.meta.jest) {
                    throw new InternalError("Missing language model in context");
                }

                const vectors = !context.languageModel
                    ? createArrayWithLength(addNewChunks.length, () => [])
                    : Array.from(
                          await context.languageModel.model.embed(
                              context.tracer.getTracer(),
                              addNewChunks.map(({chunk}) => chunk.text),
                              {inputType: "SearchDocument"},
                          ),
                          vector => Array.from(vector),
                      );

                const addCommands = addNewChunks.map(({textHash, chunk}, i) => {
                    const vector = assertExists(vectors[i]);

                    const newDoc: OpensearchIndexDocType<typeof SearchEntityEmbeddingChunkIndex> = {
                        spaceId: job.spaceId,
                        entity: {
                            type: entityIdObject.type,
                            id: job.entityId,
                            accessPolicy: entity.accessPolicy,
                            title: entity.title,
                            titleVersion: entity.titleVersion,
                            media: entity.media,
                        },
                        text: chunk.text,
                        textHash,
                        preambleEndIndex: chunk.preambleEndIndex,
                        vector: !context.languageModel
                            ? {
                                  allMiniLmL6V2: null,
                                  cohereEmbedEnglishV3: null,
                              }
                            : {
                                  allMiniLmL6V2: null,
                                  cohereEmbedEnglishV3: null,
                                  [context.languageModel.model.statics.key]: vector,
                              },
                    };

                    return new OpensearchIndexDocWithoutIdCommand(
                        SearchEntityEmbeddingChunkIndex,
                        job.spaceId,
                        newDoc,
                    );
                });

                await context.opensearch.bulk(addCommands);
            })(),
        ]);
    });
}

/**
 * Limit search query text length to avoid excessive resource usage.
 */
function assertSearchQueryTextLength(queryText: string) {
    if (queryText.length >= 140) {
        throw new InvalidArgumentError("Search query too long", {
            displayMessage: errorDisplayMessage`Your search text is too long. Try removing some words.`,
        });
    }
}

/**
 * Search for entities in a space by keyword. Returns entities that almost exactly
 * match the query text (some typos are tolerated). Entities with the query text in
 * their title or that match an exact phrase rank higher.
 *
 * This function only really works with queries containing complete words. It
 * doesn't support prefix matching of the last word which you'd need to build
 * type-ahead functionality.
 */
export async function searchByKeywords(
    context: ServerSessionActionContext | ServerBotActionContext,
    {
        spaceId,
        queryText,
        limit,
        timeZone,
        currentTime,
        debugOptions,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
        timeZone: TimeZone;
        currentTime: Date;
        debugOptions?: SearchOptions;
        botScope?: BotTokenPayloadScope;
    },
): Promise<Array<SearchEntityResultModel>> {
    await authorizeSpaceAccess(context, spaceId);

    assertSearchQueryTextLength(queryText);

    // You must have internal access to try different `debugOptions`. Setting
    // `debugOptions` not only lets you change search ranking but also enables search
    // result explanations. Search result explanations may include how frequent a term
    // is across all indexed OpenSearch documents! This is sensitive information and
    // can be used to breach private data. For example "Apple acquires Netflix" might
    // be a 3gram that appears once across all documents telling you this phrase was
    // included in some search entity you can't access.
    if (debugOptions) {
        await authorizeInternalAccess(context);
    }

    const options = debugOptions ?? standardSearchOptions;

    const accountNameIndex = await getSpaceAccountNameSearchIndex(context, spaceId);
    const actorAccount = accountNameIndex.getByIdIfExists(context.actor.getPossiblyBotAccountId());

    const {queryTexts, controlQueryTexts, filters, isLowConfidence} =
        parseSearchNaturalLanguageQuery(queryText, {
            timeZone,
            currentTime,
            actorAccount:
                context.actor.type === "Bot"
                    ? null
                    : {
                          id: context.actor.getAccountId(),
                          name: actorAccount?.initialData.name ?? missingAccountName,
                      },
            accountNameIndex,
        });

    type QueryClause = OpensearchQueryClause<
        OpensearchIndexFlattenedKeysType<typeof SearchEntityKeywordIndex>
    >;

    const createTextQueryClause = (
        boost: number,
        queryTexts: ReadonlyArray<string>,
    ): QueryClause | null => {
        const clauses = queryTexts.map((queryText): QueryClause => {
            const queryTextValue = new OpensearchQueryValue(queryText);

            // We only fuzzy match short queries. For longer queries we run into the OpenSearch
            // max clause limit error.
            //
            // We only fuzzy match when searching the individual word index. This is because
            // fuzziness works by expanding a query to include valid terms within edit
            // distance. This risks running into the max clause count OpenSearch limit when
            // used excessively. So only allow exact matches when searching the 2gram and 3gram
            // fields. This also has the effect of a 2gram match + 1gram match beating a rare
            // typo (which would have a high score due to low document frequency).
            //
            // Fuzzy matching on 2gram or 3gram fields can lead to some odd results where,
            // because we're fuzzy matching two words, we end up matching a two word pair which
            // means something completely different.
            //
            // With `prefix_length: 1` we require the first character to be correct for a fuzzy
            // query to match. This reduces the amount of fuzzy searching we need to do and
            // also discards some ridiculous fuzzy matches. For example, we see "my documents"
            // get matched to the 2gram "30 documents". For a 1gram "my" doesn't match "30"
            // since `fuzziness: "AUTO"` requires an exact match for two character strings.
            // However the 2gram "my documents" can have two edits which makes "30 documents" a
            // valid match. Also "be documents" or "of documents". A prefix length of 1
            // prevents these from being valid matches.
            const withFuzziness = queryText.length < 100;

            return {
                bool: {
                    minimum_should_match: 1,

                    // If multiple clauses match then we will add together their scores.
                    //
                    // The more fields matched, the better!
                    //
                    // - If you match a shingle it will also implicitly match the main field. Which
                    //   effectively provides a 2x boost to the phrase match.
                    // - Matches in title fields are boosted above matches in body fields.
                    should: [
                        {
                            bool: {
                                // Ignore title matches for posts since posts duplicate body content in their
                                // title.
                                filter: {
                                    bool: {
                                        must_not: [
                                            {term: {type: new OpensearchQueryValue("Post")}},
                                        ],
                                    },
                                },
                                minimum_should_match: 1,
                                should: [
                                    ...getManualMatchBoolPrefixOpensearchShouldQueryClauses({
                                        field: "title",
                                        query: queryText,
                                        fuzziness: withFuzziness ? "AUTO" : 0,
                                        prefix_length: withFuzziness ? 1 : undefined,
                                        boost: options.titleBoost * boost,
                                    }),
                                    {
                                        multi_match: {
                                            query: queryTextValue,
                                            // Sum the score from matches. This means a 3gram match will have a much higher
                                            // score than a 1gram match. Since a 3gram match's score is the 3gram match score
                                            // plus a 2gram match score plus three 1gram match scores.
                                            type: "most_fields",
                                            fields: ["title._2gram", "title._3gram"],
                                            fuzziness: 0,
                                            boost: options.titleBoost * boost,
                                        },
                                    },
                                ],
                            },
                        },
                        {
                            match: {
                                body: {
                                    query: queryTextValue,
                                    fuzziness: withFuzziness ? "AUTO" : 0,
                                    prefix_length: withFuzziness ? 1 : undefined,
                                    boost,
                                },
                            },
                        },
                        {
                            multi_match: {
                                query: queryTextValue,
                                // Sum the score from matches. This means a 3gram match will have a much higher
                                // score than a 1gram match. Since a 3gram match's score is the 3gram match score
                                // plus a 2gram match score plus three 1gram match scores.
                                type: "most_fields",
                                fields: ["body._2gram", "body._3gram"],
                                fuzziness: 0,
                                boost,
                            },
                        },
                        // Match against tags (e.g., collection names for tasks). Tags are searchable but
                        // not highlighted in results.
                        {
                            match: {
                                tags: {
                                    query: queryTextValue,
                                    fuzziness: withFuzziness ? "AUTO" : 0,
                                    prefix_length: withFuzziness ? 1 : undefined,
                                    boost,
                                },
                            },
                        },
                        {
                            multi_match: {
                                query: queryTextValue,
                                // Sum the score from matches. This means a 3gram match will have a much higher
                                // score than a 1gram match. Since a 3gram match's score is the 3gram match score
                                // plus a 2gram match score plus three 1gram match scores.
                                type: "most_fields",
                                fields: ["tags._2gram", "tags._3gram"],
                                fuzziness: 0,
                                boost,
                            },
                        },
                    ],
                },
            };
        });

        if (clauses.length === 0) return null;

        return clauses.length === 1
            ? clauses[0]!
            : // Use a disjunction max when we have multiple `queryText`s. Since the `match` uses
              // an "OR" operator not "AND". We want to use the best score across all
              // `queryText`s instead of adding the scores together.
              {dis_max: {queries: clauses}};
    };

    const textQueryClause = createTextQueryClause(1, queryTexts);

    const mustQueryClauses: Array<QueryClause> = [];
    if (textQueryClause) mustQueryClauses.push(textQueryClause);

    // Keep track of the fields we're using to filter by time. If we only filter by
    // updated time then let's use updated time to sort as well.
    const timeFilterFields = new Set<"Created" | "LastUpdated">();

    const parsedFilterByName = new Map<
        string,
        {readonly filter: SearchNaturalLanguageFilter; readonly summary: string}
    >(
        filters.map((filter, index) => [
            `filter_${index}`,
            {filter, summary: printSearchNaturalLanguageFilter(filter, timeZone, currentTime)},
        ]),
    );

    // If we parsed some filters using natural language, then add them to our query.
    // The filters are "OR"d together so we use a disjunction max query.
    if (controlQueryTexts.length > 0 || parsedFilterByName.size > 0) {
        const createTermQueryClause = (
            flattenedKey: OpensearchIndexFlattenedKeysType<typeof SearchEntityKeywordIndex>,
            values: ReadonlyArray<JsonValue>,
        ): QueryClause => {
            const opensearchValues = mapNaturalLanguageFilterToOpensearchValue(
                flattenedKey,
                values,
            );

            if (opensearchValues.length === 1)
                return {term: {[flattenedKey]: new OpensearchQueryValue(opensearchValues[0]!)}};

            return {terms: {[flattenedKey]: new OpensearchQueryValue(opensearchValues)}};
        };

        const filterQueryClauses = Array.from(parsedFilterByName.entries()).map(
            ([filterName, {filter}]): QueryClause => {
                const filterMust: Array<QueryClause> = [
                    createTermQueryClause("type", filter.entityTypes),
                ];

                if (filter.account) {
                    const accountIds = filter.account.accounts.map(account => account.id);
                    switch (filter.account.field) {
                        case "Creator": {
                            filterMust.push(createTermQueryClause("creatorId", accountIds));
                            break;
                        }
                        case "MajorContributor": {
                            filterMust.push(
                                createTermQueryClause("majorContributorIds", accountIds),
                            );
                            break;
                        }
                        case "AnyContributor": {
                            filterMust.push(createTermQueryClause("anyContributorIds", accountIds));
                            break;
                        }
                        case "Assignee": {
                            filterMust.push(createTermQueryClause("assigneeId", accountIds));
                            break;
                        }
                        default:
                            throw exhaustive(filter.account.field);
                    }
                }

                if (filter.time) {
                    timeFilterFields.add(filter.time.field);
                    const timeFilterConditionals = {
                        gte: filter.time.range.inclusiveLowerBoundDate
                            ? new OpensearchQueryValue(
                                  filter.time.range.inclusiveLowerBoundDate.toISOString(),
                              )
                            : undefined,
                        lte: filter.time.range.inclusiveUpperBoundDate
                            ? new OpensearchQueryValue(
                                  filter.time.range.inclusiveUpperBoundDate.toISOString(),
                              )
                            : undefined,
                    };

                    switch (filter.time.field) {
                        case "Created": {
                            filterMust.push({
                                range: {
                                    createdTime: timeFilterConditionals,
                                },
                            });
                            break;
                        }
                        case "LastUpdated": {
                            filterMust.push({
                                range: {
                                    lastUpdatedTime: timeFilterConditionals,
                                },
                            });
                            break;
                        }
                        default:
                            throw exhaustive(filter.time.field);
                    }
                }

                if (filter.date) {
                    // Due dates are CalendarDates (date-only, no time component). Both indexing and
                    // querying convert CalendarDate to midnight UTC via toDate("UTC"), so "January 20"
                    // always becomes "2026-01-20T00:00:00.000Z" regardless of who set it or who's
                    // searching. The user's timezone is handled upstream in the natural language
                    // parser when computing what "today" or "yesterday" means.
                    const dateFilterConditionals = {
                        gte: filter.date.range.inclusiveLowerBound
                            ? new OpensearchQueryValue(
                                  filter.date.range.inclusiveLowerBound.toDate("UTC").toISOString(),
                              )
                            : undefined,
                        lte: filter.date.range.inclusiveUpperBound
                            ? new OpensearchQueryValue(
                                  filter.date.range.inclusiveUpperBound.toDate("UTC").toISOString(),
                              )
                            : undefined,
                    };

                    switch (filter.date.field) {
                        case "Due": {
                            filterMust.push({
                                range: {
                                    dueDate: dateFilterConditionals,
                                },
                            });
                            break;
                        }
                        default:
                            throw exhaustive(filter.date.field);
                    }
                }

                if (filter.priority) {
                    filterMust.push(createTermQueryClause("priority", filter.priority));
                }

                if (filter.openness !== null) {
                    filterMust.push(createTermQueryClause("openness", filter.openness));
                }

                if (filter.activeness !== null) {
                    filterMust.push(createTermQueryClause("activeness", filter.activeness));
                }

                return {
                    constant_score: {
                        boost: isLowConfidence
                            ? options.naturalLanguage.filterConstantScoreIfLowConfidence
                            : options.naturalLanguage.filterConstantScore,
                        filter: {bool: {filter: filterMust}},
                        _name: filterName,
                    },
                };
            },
        );

        const controlTextQueryClause = createTextQueryClause(
            isLowConfidence
                ? options.naturalLanguage.controlMatchBoostIfLowConfidence
                : options.naturalLanguage.controlMatchBoost,
            controlQueryTexts,
        );

        mustQueryClauses.push({
            dis_max: {
                queries: [
                    ...filterQueryClauses,
                    ...(controlTextQueryClause ? [controlTextQueryClause] : []),
                ],
            },
        });
    }

    const accessPolicyQueryClause = await getOpensearchActorAccessQueryClause(
        context,
        spaceId,
        "Keyword",
    );

    const {hits} = await context.opensearch.searchWithoutSource(SearchEntityKeywordIndex, spaceId, {
        explain: !!debugOptions,
        size: limit,
        storedFields: ["title", "titleVersion", "media"],
        sort: [
            "_score",

            // Default to sorting by `createdTime` when scores are tied, but if we parse an
            // update time natural language filter then sort by update time.
            timeFilterFields.size === 0 || timeFilterFields.has("Created")
                ? {createdTime: {order: "desc", missing: "_last"}}
                : {lastUpdatedTime: {order: "desc", missing: "_last"}},

            "_doc",
        ],
        query: {
            bool: {
                must: mustQueryClauses,

                // Use filter context to only match content the user is allowed to see. The content
                // must be in our space and must grant access to the account. Either directly or
                // through a default grant.
                filter: [
                    {term: {spaceId: new OpensearchQueryValue(spaceId)}},
                    accessPolicyQueryClause,
                ],
            },
        },
        highlight: {
            type: "unified",
            // Split the text at sentences for highlighting. That way the highlighted previews
            // are complete thoughts for the user to read.
            boundary_scanner: "sentence",
            boundary_scanner_locale: "en-US",
            // Return only the one best fragment. Given we use a sentence boundary this should
            // be a nice readable snippet.
            number_of_fragments: 1,
            order: "score",
            // We want to show two sentences of content for search results. Given fragments are
            // created at sentence boundaries that means we need enough characters to cover at
            // least two sentences. We discovered that p95 sentence length is 260 by analyzing
            // ~500,000 sentences in the [GoodWiki dataset][1].
            //
            // [1]: https://huggingface.co/datasets/euirim/goodwiki
            fragment_size: 260 * 2,
            no_match_size: 260 * 2,
            fields: {
                // We only highlight `body`. The entire `title` is generally returned as part of
                // the search entity.
                body: {},
            },
        },
    });

    const results = await runAllPromises(
        hits.map(async (hit): Promise<SearchEntityResultModel> => {
            const entityId = fromSearchEntityIdForKeywordIndex(hit.id);

            // The highlighted body text we get from OpenSearch is markdown formatted with
            // `<em>` tags inserted where we need to highlight. To get this in a format we can
            // render:
            //
            // 1. Parse the Markdown back to a ProseMirror node
            // 2. Print the ProseMirror node to a single line of text
            let rawBodyTextSnippet = hit.highlight?.body?.[0];

            // NOTE(calebmer): I've found sometimes OpenSearch returns text that starts like
            // this: ". Cultural references. The overall plot is a reference...". Note the ". "
            // at the beginning of the string. This seems to me like confused sentence boundary
            // scanning. Since having terminal punctuation at the beginning of our body text
            // snippet is almost never useful, remove it.
            rawBodyTextSnippet = rawBodyTextSnippet?.replace(/^\p{Sentence_Terminal}\s*/u, "");

            const bodySnippet = rawBodyTextSnippet
                ? parseSearchContent(rawBodyTextSnippet, {
                      shouldParseEmphasisHtmlTagAsHighlight: true,
                  })
                : null;

            let bodyTextSnippet = bodySnippet
                ? printContentSingleLineTextSnippetPreservingMarks(bodySnippet, {
                      shouldPreserveMark: mark => mark.type.name === "highlight",
                      // We serialize mentions to search as their underlying text content. So we'll never
                      // have any mentions when parsing the body text snippet from our search index.
                      getAccountIfExists: () => null,
                      getSearchEntityIfExists: () => null,
                      getFileIfExists: () => null,
                  }).map(segment => ({isHighlighted: segment.marks.length > 0, text: segment.text}))
                : emptyArray;

            const hitMedia = hit.fields.media?.[0];

            let media: SearchEntityMediaModel | null = null;
            if (hitMedia) {
                if (hitMedia.type === "TaskCollectionColor") {
                    media = hitMedia;
                } else {
                    media = await prepareSearchEntityMediaForResult(
                        context,
                        spaceId,
                        entityId,
                        hitMedia,
                    );
                }
            }

            // If this hit is for a task collection then we'll include, as the search result
            // body, a summary of how many tasks are in the collection and when the collection
            // was last updated. This is helpful for a user comparing multiple task collections
            // with the same name.
            //
            // We don't have this logic in `searchBySemantics()` since task collections
            // shouldn't appear in affinity search.
            if (entityId.startsWith("TaskCollection:") && bodyTextSnippet.length === 0) {
                const taskCollectionBodyTextSnippet =
                    await getTaskCollectionSearchResultBodyTextSnippetIfPossible(
                        context,
                        assertId<TaskCollectionId>(entityId.slice(15)),
                        timeZone,
                        currentTime,
                    );

                if (taskCollectionBodyTextSnippet !== null) {
                    bodyTextSnippet = [{text: taskCollectionBodyTextSnippet, isHighlighted: false}];
                }
            }

            // Check if a natural language filter matched this result
            let parsedFilterSummary: string | null = null;
            if (hit.matchedQueries && hit.matchedQueries.length > 0) {
                parsedFilterSummary = joinPrettyConjunctionList(
                    hit.matchedQueries
                        .map(filterName => {
                            const parsedFilter = parsedFilterByName.get(filterName);
                            if (!parsedFilter) return null;

                            return parsedFilter.summary;
                        })
                        .filter(isNonNullable),
                );
            }

            let model: SearchEntityModel | AccountModel;

            if (!isSearchEntityModelId(entityId)) {
                // The only `SearchEntityId` which isn't a `SearchEntityModelId` is
                // `Account:${AccountId}`. Expect that account search entities always have an
                // account media object.
                assert(hitMedia?.type === "Account");

                model = await getAccount(context, spaceId, hitMedia.accountId);
            } else {
                model = new SearchEntityModel({
                    id: entityId,
                    title: prepareSearchEntityTitleForResult(
                        context.actor.type,
                        entityId,
                        hit.fields.title?.[0] ?? null,
                        media,
                    ),
                    titleVersion: hit.fields.titleVersion?.[0] ?? null,
                    media,
                });
            }

            return new SearchEntityResultModel({
                model,
                score: hit.score,
                bodyTextSnippet,
                explanation: hit.explanation
                    ? enrichOpensearchSearchHitExplanation(
                          options,
                          isLowConfidence,
                          hit.explanation,
                      )
                    : undefined,
                parsedFilter: parsedFilterSummary ? {summary: parsedFilterSummary} : null,
            });
        }),
    );

    return results;
}

/**
 * Manually creates a `match_bool_prefix` query equivalent. `match_bool_prefix`
 * performs a `match` on everything but the last word. For the last word OpenSearch
 * runs a prefix query. However, the problem is OpenSearch's prefix query returns a
 * constant score (the `boost` value) instead of a score based on IDF we'd get
 * using the `match` query.
 *
 * An example from tests:
 *
 * - We search for the word "Help"
 * - `match_bool_prefix` runs a prefix query for the only word "Help" which returns
 *   a doc with a score of ~1.8
 * - `match` returns a doc with a score of ~8
 *
 * The test failed since "Help"'s score of 1.8 (for a title match) was lower than
 * some other body match using an IDF score so our title match ranked lower than
 * the body match!
 *
 * So instead of using `match_bool_prefix` we manually create an equivalent query.
 * Except the last word takes the higher score of `match` or `prefix` (instead of
 * always taking the `prefix` score). So if `match` returns a score of 8 and
 * `prefix` returns a score of 1.8 we'll use the score 8.
 *
 * IMPORTANT: These query clauses must go inside a `should` query with
 * `minimum_should_match: 1`.
 */
function getManualMatchBoolPrefixOpensearchShouldQueryClauses<FlattenedKeys extends string>({
    field,
    query,
    fuzziness,
    prefix_length,
    boost,
}: {
    field: FlattenedKeys;
    query: string;
    fuzziness?: "AUTO" | number;
    prefix_length?: number;
    boost?: number;
}): Array<OpensearchQueryClause<FlattenedKeys>> {
    const queryClauses: Array<OpensearchQueryClause<string>> = [];

    const matches = Array.from(query.trimEnd().matchAll(/\p{White_Space}+/gu));

    if (matches.length === 0) {
        queryClauses.push({
            dis_max: {
                queries: [
                    {
                        match: {
                            [field]: {
                                query: new OpensearchQueryValue(query),
                                fuzziness,
                                prefix_length,
                                boost,
                            },
                        },
                    },
                    {
                        prefix: {
                            [field]: {
                                value: new OpensearchQueryValue(query),
                                boost,
                                case_insensitive: true,
                            },
                        },
                    },
                ],
            },
        });
    } else {
        const lastMatch = matches[matches.length - 1]!;

        const queryStart = query.slice(0, lastMatch.index);
        const queryEnd = query.slice(lastMatch.index + lastMatch[0].length);

        queryClauses.push({
            match: {
                [field]: {
                    query: new OpensearchQueryValue(queryStart),
                    fuzziness,
                    prefix_length,
                    boost,
                },
            },
        });

        queryClauses.push({
            dis_max: {
                queries: [
                    {
                        match: {
                            [field]: {
                                query: new OpensearchQueryValue(queryEnd),
                                fuzziness,
                                prefix_length,
                                boost,
                            },
                        },
                    },
                    {
                        prefix: {
                            [field]: {
                                value: new OpensearchQueryValue(queryEnd),
                                boost,
                                case_insensitive: true,
                            },
                        },
                    },
                ],
            },
        });
    }

    return queryClauses as Array<OpensearchQueryClause<FlattenedKeys>>;
}

function enrichOpensearchSearchHitExplanation(
    options: SearchOptions,
    isLowConfidence: boolean,
    explanation: OpensearchSearchHitExplanation,
): OpensearchSearchHitExplanation {
    // If we have a `ConstantScore` in our explanation the means we parsed a natural
    // language filter from the query text and the natural language filter matched!
    //
    // We only use constant score queries for natural language filters currently.
    if (
        explanation.description.startsWith("ConstantScore(") &&
        new RegExp(
            "^ConstantScore\\(.*\\)\\^" +
                escapeRegExp(
                    String(
                        isLowConfidence
                            ? options.naturalLanguage.filterConstantScoreIfLowConfidence
                            : options.naturalLanguage.filterConstantScore,
                    ),
                ) +
                "(?:\\.\\d+)?$",
        ).test(explanation.description)
    ) {
        return {
            value: explanation.value,
            description: "\u2699\uFE0F natural language filter match:",
            details: [explanation],
        };
    }

    let hasChildExplanationChanged = false;

    const newChildExplanations = explanation.details.map(childExplanation => {
        const newChildExplanation = enrichOpensearchSearchHitExplanation(
            options,
            isLowConfidence,
            childExplanation,
        );

        if (childExplanation !== newChildExplanation) {
            hasChildExplanationChanged = true;
        }

        return newChildExplanation;
    });

    if (!hasChildExplanationChanged) return explanation;
    return {...explanation, details: newChildExplanations};
}

/**
 * Search for entities in a space by their semantic meaning. This uses a language
 * model to embed the query and compare it against embeddings of other content
 * throughout the space. So you can search by meaning, not just words.
 *
 * An example is you're looking for a document titled "Marketing Q3 QBR" (QBR
 * standing for "Quarterly Business Review"). You know there's some review doc but
 * you don't know what it's called. So you search "marketing team monthly business
 * review". Language models are capable of figuring out "monthly business review"
 * and "QBR" mean similar things so you find the right matching document.
 */
// TODO(calebmer, #security): I suspect that this function is quite susceptible to
// timing attacks. For example, let's say you work at company X and search "company
// Y acquires company X". If private documents or chat messages exist talking about
// an acquisition your search may take a long time because we find these entities,
// skip over them since they don't match the filters, then try the next nearest
// entity. So from a search taking a long time you can infer OpenSearch is doing
// work to check and throw out chunks.
//
// This can be worse since OpenSearch doesn't appear to partition KNN indexes. So
// when doing a KNN search you're also considering embeddings in other spaces! So
// you may be able to devise a prompt to figure out private information in another
// company's space!
//
// To fix this we could have this function always wait at least 300ms or whatever
// p90 performance is. We show keyword search results to the user first so it's ok
// if semantic search results are a bit slower. Once we have some experience with
// this function in production, evaluate the timing attack risk.
export async function searchBySemantics(
    context: Context<
        ServerAccountActionContextModules & {
            languageModel?: LanguageModelContextModule;
        }
    >,
    {
        spaceId,
        queryText,
        limit,
        timeZone,
        currentTime,
        debugOptions,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
        timeZone: TimeZone;
        currentTime: Date;
        debugOptions?: SearchOptions;
    },
): Promise<Array<SearchEntityResultModel>> {
    if (!context.languageModel && !import.meta.jest) {
        throw new InternalError("Missing language model in context");
    } else if (!context.languageModel) {
        // If we don't have a language model in the test context, then don't perform the
        // semantic search.
        return [];
    }

    await authorizeSpaceAccess(context, spaceId);

    assertSearchQueryTextLength(queryText);

    // You must have internal access to try different `debugOptions`.
    if (debugOptions) {
        await authorizeInternalAccess(context);
    }

    const options = debugOptions ?? standardSearchOptions;

    const accountNameIndex = await getSpaceAccountNameSearchIndex(context, spaceId);
    const actorAccount = accountNameIndex.getByIdIfExists(context.actor.getPossiblyBotAccountId());

    const {filters, isLowConfidence} = parseSearchNaturalLanguageQuery(queryText, {
        timeZone,
        currentTime,
        actorAccount:
            context.actor.type === "Bot"
                ? null
                : {
                      id: context.actor.getAccountId(),
                      name: actorAccount?.initialData.name ?? missingAccountName,
                  },
        accountNameIndex,
    });

    // If we have high confidence natural language filters then don't perform semantic
    // search. Since semantic search will invent meaning that disagrees with the
    // meaning we've determined for the user by parsing their query.
    if (filters.length > 0 && !isLowConfidence) return [];

    const [queryEmbeddingVector] = await context.languageModel.model.embed(
        context.tracer.getTracer(),
        [queryText],
        {inputType: "SearchQuery"},
    );

    assert(queryEmbeddingVector);

    const accessPolicy = await getOpensearchActorAccessQueryClause(context, spaceId, "Semantic");
    const {hits} = await context.opensearch.searchWithoutSource(
        SearchEntityEmbeddingChunkIndex,
        spaceId,
        {
            size: limit,
            storedFields: [
                "entity.id",
                "entity.title",
                "entity.titleVersion",
                "entity.media",
                "text",
                "preambleEndIndex",
            ],
            sort: ["_score"],
            query: {
                knn: {
                    [`vector.${context.languageModel.model.statics.key}`]: {
                        vector: new OpensearchQueryValue(
                            Array.isArray(queryEmbeddingVector)
                                ? queryEmbeddingVector
                                : Array.from(queryEmbeddingVector),
                        ),

                        // A higher `k` value improves recall. Picking an arbitrary value for now. Really,
                        // we should test what provides the best recall. See:
                        // https://www.pinecone.io/learn/k-nearest-neighbor/#How-to-find-k
                        k: Math.max(limit, 30),

                        // We filter chunks here (instead of with a boolean filter) to perform efficient
                        // KNN-filtering which is a hybrid of pre-filtering and post-filtering.
                        // https://opensearch.org/docs/latest/search-plugins/knn/filter-search-knn
                        filter: {
                            bool: {
                                // Use filter context to only match content the user is allowed to see. The content
                                // must be in our space and must grant access to the account. Either directly or
                                // through a default grant.
                                filter: [
                                    {
                                        term: {
                                            spaceId: new OpensearchQueryValue(spaceId),
                                        },
                                    },
                                    accessPolicy,
                                ],
                            },
                        },
                    },
                },
            },
        },
    );

    const queryTokens = new Set(
        mapIterable(
            approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer(queryText),
            token => token.text,
        ),
    );

    const highestScoreByEntityId = new Map<SearchDynamicEntityId, number>();

    const results = await runAllPromises(
        hits.map(async (hit): Promise<SearchEntityResultModel | null> => {
            const entityId = assertExists(hit.fields["entity.id"]?.[0]);

            // If we've already seen this entity, return null. We only return one result per
            // entity and only the result with the highest score. The first entity we see
            // should have the highest score given the hit list is sorted by score (we double
            // check this with an `assert()`).
            const highestScore = highestScoreByEntityId.get(entityId);
            if (highestScore !== undefined) {
                assert(highestScore >= hit.score);
                return null;
            }
            highestScoreByEntityId.set(entityId, hit.score);

            const score = hit.score * options.semanticScoreScaleFromOpensearch;

            // TODO(calebmer): Instead of filtering out hits that don't meet the minimum score
            // here, I wish I could have OpenSearch stop if it can't find hits better than this
            // score. But I can't seem to find the OpenSearch parameter that will let me do
            // this?
            if (score < options.minSemanticScore) return null;

            // The highlighted body text we get from OpenSearch is markdown formatted with
            // `<em>` tags inserted where we need to highlight. To get this in a format we can
            // render:
            //
            // 1. Parse the Markdown back to a ProseMirror node
            // 2. Print the ProseMirror node to a single line of text
            let rawBodyTextSnippet = hit.fields.text?.[0];
            const preambleEndIndex = hit.fields?.preambleEndIndex?.[0];

            // Remove the preamble from the chunk text.
            rawBodyTextSnippet =
                typeof preambleEndIndex === "number"
                    ? rawBodyTextSnippet?.slice(preambleEndIndex)
                    : rawBodyTextSnippet;

            // If the chunk text starts with the document header then remove that.
            rawBodyTextSnippet = rawBodyTextSnippet?.replace(/^\s*#\s+[^\n]+\n/, "");

            // Emulate OpenSearch highlighting. So if our semantic search chunk text matches
            // the query words at all the user sees highlighted text as expected.
            //
            // As of 2023-12-18 our in-process highlighter doesn't have full compatibility with
            // OpenSearch's highlighter. For example, we don't support highlighting tokens that
            // would have been split up by the `word_delimiter_graph` filter and we don't
            // support highlighting typos from a fuzzy match.
            if (rawBodyTextSnippet) {
                let offsetIndex = 0;
                const highlightTagStart = "<em>";
                const highlightTagEnd = "</em>";

                for (const token of approximatelyAnalyzeLikeOpensearchIndexEnglishWithWordDelimeterGraphAnalyzer(
                    rawBodyTextSnippet,
                )) {
                    if (!queryTokens.has(token.text)) continue;

                    rawBodyTextSnippet =
                        rawBodyTextSnippet.slice(0, offsetIndex + token.sourceStartIndex) +
                        highlightTagStart +
                        rawBodyTextSnippet.slice(
                            offsetIndex + token.sourceStartIndex,
                            offsetIndex + token.sourceStartIndex + token.sourceLength,
                        ) +
                        highlightTagEnd +
                        rawBodyTextSnippet.slice(
                            offsetIndex + token.sourceStartIndex + token.sourceLength,
                        );

                    offsetIndex += highlightTagStart.length + highlightTagEnd.length;
                }
            }

            const bodySnippet = rawBodyTextSnippet
                ? parseSearchContent(rawBodyTextSnippet, {
                      shouldParseEmphasisHtmlTagAsHighlight: true,
                  })
                : null;

            const bodyTextSnippet = bodySnippet
                ? printContentSingleLineTextSnippetPreservingMarks(bodySnippet, {
                      shouldPreserveMark: mark => mark.type.name === "highlight",
                      // We serialize mentions to search as their underlying text content. So we'll never
                      // have any mentions when parsing the body text snippet from our search index.
                      getAccountIfExists: () => null,
                      getSearchEntityIfExists: () => null,
                      getFileIfExists: () => null,
                  }).map(segment => ({
                      isHighlighted: segment.marks.length > 0,
                      text: segment.text,
                  }))
                : [];

            const hitMedia = hit.fields["entity.media"]?.[0];

            const media = hitMedia
                ? await prepareSearchEntityMediaForResult(context, spaceId, entityId, hitMedia)
                : null;

            let model: SearchEntityModel | AccountModel;

            if (!isSearchEntityModelId(entityId)) {
                // The only `SearchEntityId` which isn't a `SearchEntityModelId` is
                // `Account:${AccountId}`. Expect that account search entities always have an
                // account media object.
                assert(hitMedia?.type === "Account");

                model = await getAccount(context, spaceId, hitMedia.accountId);
            } else {
                model = new SearchEntityModel({
                    id: entityId,
                    title: prepareSearchEntityTitleForResult(
                        context.actor.type,
                        entityId,
                        hit.fields["entity.title"]?.[0] ?? null,
                        media,
                    ),
                    titleVersion: hit.fields["entity.titleVersion"]?.[0] ?? null,
                    media,
                });
            }

            return new SearchEntityResultModel({
                model,
                score: hit.score,
                bodyTextSnippet,
                parsedFilter: null,
            });
        }),
    );

    return results.filter(isNonNullable);
}

async function prepareSearchEntityMediaForResult(
    context: ServerActionContext,
    spaceId: SpaceId,
    entityId: SearchDynamicEntityId,
    media: SearchEntityMedia,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<SearchEntityMediaModel> {
    switch (media.type) {
        case "Account": {
            const account = await getAccount(context, spaceId, media.accountId, options);
            return {type: "Account", account};
        }
        case "AccountPile": {
            const sortAccountIdLast = (accountId: AccountId) => {
                switch (context.actor.type) {
                    case "System":
                    case "Anonymous":
                    case "Bot": {
                        return false;
                    }
                    case "Session":
                    case "ImpersonatedAccount": {
                        return accountId === context.actor.getAccountId();
                    }
                    default:
                        throw exhaustive(context.actor);
                }
            };

            // Show two accounts that aren't our actor's account. We randomly show two
            // different accounts (`media.accountIds` should be shuffled by
            // `getSearchEntity()`) for every chat to try and help make different chats appear
            // differently.
            //
            // If there are only two accounts then we'll show our actor account but we'll show
            // it last.
            const previewAccountIds = Array.from(media.previewAccountIds)
                .sort((accountId1, accountId2) => {
                    const sortAccountId1Last = sortAccountIdLast(accountId1);
                    const sortAccountId2Last = sortAccountIdLast(accountId2);

                    if (sortAccountId1Last && sortAccountId2Last) return 0;
                    if (sortAccountId1Last) return 1;
                    if (sortAccountId2Last) return -1;

                    return 0;
                })
                .slice(
                    0,
                    // Make sure we slice after the filter. We want to accounts excluding the actor
                    // account.
                    searchChatEntityResultTitlePreviewAccountCount,
                );

            const previewAccounts = await runAllPromises(
                mapIterable(previewAccountIds, accountId =>
                    getAccount(context, spaceId, accountId, options),
                ),
            );

            return {
                type: "AccountPile",
                previewAccounts,
                accountCount: media.accountCount,
            };
        }
        case "TaskCollectionColor":
        case "TaskDisplayStatus": {
            return media;
        }
        default:
            throw exhaustive(media);
    }
}

/**
 * The title of chat search entities is pretty ugly. It's the concatenation of the
 * full names of all accounts in the chat. When presenting a search result for a
 * chat use a nicer name which is a concatenation of short names excluding the
 * actor. We use the short names of the accounts in the chat's `AccountPile` media.
 */
function prepareSearchEntityTitleForResult(
    actorType: ServerActionContext["actor"]["type"],
    entityId: SearchDynamicEntityId,
    title: string | null,
    media: SearchEntityMediaModel | null,
): string | null {
    if (title === null) return null;

    if (
        media?.type !== "AccountPile" ||
        !entityId.startsWith("Chat:") ||
        // HACK: Room chats have a null `accountCount` whereas direct chats have an integer
        // `accountCount`. So check `accountCount === null` to tell if this is a room chat.
        media.accountCount === null
    ) {
        return title;
    }

    return prepareSearchDirectChatEntityTitleForResult(actorType, media);
}

type SearchEntityModelBaseResult =
    | {
          isPrivate: false;
          id: SearchDynamicEntityId;
          spaceId: SpaceId;
          title: string | null;
          titleVersion: SearchEntityTitleVersion | null;
          media: SearchEntityMediaModel | null;
      }
    | {isPrivate: true};

type SearchEntityIndexDoc = {
    readonly id: SearchEntityIdForKeywordIndex;
    readonly routing: SpaceId;
    readonly version: OpensearchClientDocVersion | null;
    readonly fields: {
        readonly title?: ReadonlyArray<string>;
        readonly titleVersion?: ReadonlyArray<SearchEntityTitleVersion>;
        readonly media?: ReadonlyArray<SearchEntityMedia>;
        readonly "accessPolicy.accountGrantAccountIds"?: ReadonlyArray<AccountId>;
        readonly "accessPolicy.defaultGrantType"?: ReadonlyArray<"Space">;
        readonly "accessPolicy.urlGrantLevel"?: ReadonlyArray<AccessPolicyUrlGrant["level"]>;
    };
};

const SearchEntityCache = new ContextCache<
    `${SpaceId}:${SearchDynamicEntityId}`,
    SearchEntityIndexDoc | null
>({
    // We load the data from OpenSearch completely independently of the actor. So it's
    // safe to share the cache when the actor changes.
    whenActorChanges: "DangerouslyShare",
});

const SearchEntityBatcher = new ContextBatcher<
    ServerActionContextModules,
    {spaceId: SpaceId; entityId: SearchDynamicEntityId},
    SearchEntityIndexDoc | null
>(
    {
        // Loading search entities doesn't depend on the actor so it's ok to dangerously
        // share the search entity batch across actors.
        whenActorChanges: "DangerouslyShare",
    },
    async (context, inputs) => {
        const commands = inputs.map(({spaceId, entityId}) => {
            return new OpensearchGetDocWithoutSourceCommand(
                SearchEntityKeywordIndex,
                spaceId,
                intoSearchEntityIdForKeywordIndex(spaceId, entityId),
                {
                    storedFields: [
                        "title",
                        "titleVersion",
                        "media",
                        "accessPolicy.accountGrantAccountIds",
                        "accessPolicy.defaultGrantType",
                        "accessPolicy.urlGrantLevel",
                    ],
                },
            );
        });

        const docsByIdByIndex = await context.opensearch.multiGetDocByIdByIndexIfExist(commands);
        const docsById = docsByIdByIndex.get(SearchEntityKeywordIndex) ?? emptyMap;

        return commands.map(command => docsById.get(command.id) ?? null);
    },
);

export const fallbackGetSearchEntityBaseIfPossibleTestCounter =
    new TestCounter<SearchMentionEntityId>();

export async function getSearchEntityWithStrongConsistency(
    context: ServerActionContext,
    spaceId: SpaceId,
    entityId: SearchMentionEntityId,
) {
    const {type} = parseSearchMentionEntityId(entityId);

    const entity = await fallbackGetSearchEntityBaseIfPossible(
        // It's expected that `fallbackGetSearchEntityBaseIfPossible()` loads everything at
        // strong consistency. Add that assertion here.
        context.dynamo.expectStrongReadConsistency(),
        spaceId,
        entityId,
        new Set(),
    );

    if (entity === null) {
        throw new NotFoundError("Search entity not found", {
            displayMessage: errorDisplayMessage`This ${getSearchEntityNoun(type)} doesn’t exist.`,
        });
    }

    if (entity.isPrivate) {
        throw new PermissionDeniedError("Search entity is private", {
            displayMessage: errorDisplayMessage`You aren’t allowed to access this ${getSearchEntityNoun(type)}.`,
        });
    }

    if (entity.spaceId !== spaceId) {
        throw new FailedPreconditionError("Search entity is in the wrong space", {
            displayMessage: errorDisplayMessage`This ${getSearchEntityNoun(type)} is in the wrong space.`,
        });
    }

    return {
        id: entityId,
        title: entity.title,
        titleVersion: entity.titleVersion,
        media: entity.media,
    };
}

/**
 * If we can't find a search entity in OpenSearch then we run this fallback which
 * tries to load the search entity from its original source. Which is DynamoDB for
 * most things but we load tasks from `TaskRealtimeService`.
 */
async function fallbackGetSearchEntityBaseIfPossible(
    context: ServerActionContext,
    spaceId: SpaceId,
    entityId: SearchMentionEntityId,
    seen: ReadonlySet<SearchEntityId>,
): Promise<SearchEntityModelBaseResult | null> {
    fallbackGetSearchEntityBaseIfPossibleTestCounter.incrementForTest(entityId);

    const entityIdObject = parseSearchMentionEntityId(entityId);

    switch (entityIdObject.type) {
        case "Document": {
            const documentResult = await getDocumentPreviewIfPossible(
                context,
                entityIdObject.documentId,
                {consistency: "StrongWithinCache"},
            );
            if (!documentResult) return null;
            if (!documentResult.ok) return {isPrivate: true};
            const document = documentResult.value;

            return {
                isPrivate: false,
                id: entityId,
                spaceId: document.spaceId,
                title: document.getTitle(),
                titleVersion: {type: "Integer", version: document.version},
                media: null,
            };
        }
        case "Channel": {
            const channelResult = await getChannelPreviewIfPossible(
                context,
                entityIdObject.channelId,
                {consistency: "StrongWithinCache"},
            );
            if (!channelResult) return null;
            if (!channelResult.ok) return {isPrivate: true};
            const channel = channelResult.value;

            return {
                isPrivate: false,
                id: entityId,
                spaceId: channel.spaceId,
                title: channel.name,
                titleVersion: {type: "Integer", version: channel.version},
                media: null,
            };
        }
        case "Chat": {
            const chatResult = await getChatDefinitionIfPossible(context, entityIdObject.chatId, {
                consistency: "StrongWithinCache",
            });
            if (!chatResult) return null;
            if (!chatResult.ok) return {isPrivate: true};
            const chat = chatResult.value;

            switch (chat.definition.type) {
                case "Room": {
                    return {
                        isPrivate: false,
                        id: entityId,
                        spaceId: chat.spaceId,
                        title: chat.definition.name,
                        titleVersion: {type: "Integer", version: chat.version},
                        media: await prepareSearchEntityMediaForResult(
                            context,
                            spaceId,
                            entityId,
                            getSearchRoomChatEntityMedia(
                                entityIdObject.chatId,
                                chat.definition.creatorId,
                                getChatSearchEntityContributorIds(
                                    chat.definition,
                                    chat.messagesSummary,
                                ),
                            ),
                            {consistency: "StrongWithinCache"},
                        ),
                    };
                }
                case "Direct": {
                    // If a chat has one or two accounts, we don't index the chat. Instead you should
                    // access a 1:1 chat with another account by searching for their account entity
                    // (indexed by `getAccountSearchEntity()`).
                    //
                    // This matches the behavior of `getChatSearchEntity()`.
                    if (chat.definition.accountIds.size <= 2) return null;

                    const media = await prepareSearchEntityMediaForResult(
                        context,
                        spaceId,
                        entityId,
                        {
                            type: "AccountPile",
                            previewAccountIds: sortSearchDirectChatEntityAccountIds(
                                entityIdObject.chatId,
                                chat.definition.accountIds,
                            ).slice(
                                0,
                                // Add 1 to make sure we can filter out the actor account and still have enough
                                // accounts to render a nice looking pile.
                                searchChatEntityResultTitlePreviewAccountCount + 1,
                            ),
                            accountCount: chat.definition.accountIds.size,
                        },
                        {consistency: "StrongWithinCache"},
                    );

                    let title: string;

                    if (media.type !== "AccountPile") {
                        assert(media.type === "Account");
                        title = media.account.initialData.name;
                    } else {
                        title = prepareSearchDirectChatEntityTitleForResult(
                            context.actor.type,
                            media,
                        );
                    }

                    return {
                        isPrivate: false,
                        id: entityId,
                        spaceId: chat.spaceId,
                        title,
                        titleVersion: null,
                        media,
                    };
                }
                default:
                    throw exhaustive(chat.definition);
            }
        }
        case "Task": {
            const taskResult = await context.tasks.getTaskWithoutDependenciesIfPossible(
                spaceId,
                entityIdObject.taskId,
                {consistency: "StrongWithinCache"},
            );
            if (!taskResult) return null;
            if (!taskResult.ok) return {isPrivate: true};
            const task = taskResult.value;

            return {
                ...getTaskSearchEntityBase(task),
                isPrivate: false,
                id: entityId,
                spaceId: task.getSpaceId(),
            };
        }
        case "TaskCollection": {
            const collectionResult = await context.tasks.getCollectionIfPossible(
                spaceId,
                entityIdObject.collectionId,
                {consistency: "StrongWithinCache"},
            );
            if (!collectionResult) return null;
            if (!collectionResult.ok) return {isPrivate: true};
            const collection = collectionResult.value;

            return {
                ...getTaskCollectionSearchEntityBase(collection),
                isPrivate: false,
                id: entityId,
                spaceId: collection.getSpaceId(),
            };
        }
        case "Post": {
            const postResult = await getPostContentAndChannelPreviewIfPossible(
                context,
                entityIdObject.postId,
                {consistency: "StrongWithinCache"},
            );
            if (!postResult) return null;
            if (!postResult.ok) return {isPrivate: true};
            const post = postResult.value;

            const postContentTitleSnippet = getPostSearchEntityTitleContentSnippet(post.content);

            const [postAuthor, references] = await runAllPromises([
                getAccountOrDangerouslyGetStubWithoutAuthorization(
                    // It's fine to read references with eventual consistency.
                    context.dynamo.unexpectStrongReadConsistency(),
                    spaceId,
                    post.authorId,
                ),
                fallbackGetSearchContentReferences(
                    // It's fine to read references with eventual consistency.
                    context.dynamo.unexpectStrongReadConsistency(),
                    spaceId,
                    entityId,
                    postContentTitleSnippet,
                    seen,
                ),
            ]);

            const title = createPostSearchEntityTitleWithAlreadySnippedContent(
                post.channel.name,
                postContentTitleSnippet,
                getContentReferencesForServerPrintSingleLineTextSnippet(references),
            );

            return {
                isPrivate: false,
                id: entityId,
                spaceId: post.spaceId,
                title,
                titleVersion: {type: "Integers", versions: [post.version, post.channel.version]},
                media: {type: "Account", account: postAuthor},
            };
        }
        default:
            throw exhaustive(entityIdObject);
    }
}

async function fallbackGetSearchContentReferences(
    context: ServerActionContext,
    spaceId: SpaceId,
    originEntityId: SearchEntityId,
    content: Node,
    seen: ReadonlySet<SearchEntityId>,
): Promise<ContentReferences> {
    seen = new Set(addToIterable(seen, originEntityId));

    const referencedIds = getContentReferencedIdsForNode(content);
    const referencedSearchEntityIds = Array.from(referencedIds.searchEntityIds);

    const [referencedAccounts, referencedSearchEntities] = await runAllPromises([
        runAllPromises(
            mapIterable(referencedIds.accountIds, accountId => {
                // You may have copy/pasted some content from a different space. In that case a
                // mentioned user may not exist.
                return getAccountIfExists(context, spaceId, accountId);
            }),
        ),
        runAllPromises(
            mapIterable(referencedSearchEntityIds, entityId => {
                // If we've already seen this `entityId` then instead of loading it again (which
                // would cause an infinite loop), break the cycle.
                if (seen.has(entityId)) {
                    return {
                        isPrivate: false,
                        entity: new SearchEntityModel({
                            id: entityId,
                            title: "[…]",
                            titleVersion: null,
                            media: null,
                        }),
                    };
                }

                // You may have copy/pasted some content from a different space. In that case a
                // mentioned entity may not exist.
                return getSearchMentionEntityIfPossible(context, spaceId, entityId, seen);
            }),
        ),
    ]);

    return {
        ...emptyContentReferences,
        accountById: new Map(
            filterMapIterable(referencedAccounts, account => {
                if (!account) return;
                return [account.id, account];
            }),
        ),
        searchEntityById: new Map(
            filterMapIterable(referencedSearchEntities, (searchEntity, index) => {
                if (!searchEntity) return;
                const searchEntityId = referencedSearchEntityIds[index]!;
                return [searchEntityId, searchEntity];
            }),
        ),
    };
}

/**
 * Get the titles and media of the provided search entity if the search entity
 * exists and the account has access to the search entity. The media will be
 * returned as `SearchEntityMediaModel` to be `SearchEntityModel` ready.
 */
async function getSearchEntityBaseIfPossible(
    context: ServerActionContext,
    spaceId: SpaceId,
    entityId: SearchDynamicEntityId,
    seen: ReadonlySet<SearchEntityId> = emptySet,
): Promise<SearchEntityModelBaseResult | null> {
    const doc = await SearchEntityCache.get(context, `${spaceId}:${entityId}`, () => {
        return context.batch.execute(SearchEntityBatcher, {spaceId, entityId});
    });

    // Make sure the doc we get is from the right space. Providing a `routing` value to
    // OpenSearch only makes sure our request goes to the right node. If space A and
    // space B are saved on the same OpenSearch node and an attacker requests document
    // in space B from their space A then OpenSearch will return the doc even though
    // the `routing` value doesn't exactly match since `routing` puts the request on
    // the node that shares space A and space B.
    //
    // So for security make sure we check the routing value is exactly equal to our
    // `SpaceId`!
    if (doc && doc.routing !== spaceId) {
        return null;
    }

    if (!doc) {
        if (!isSearchMentionEntityId(entityId)) {
            // Fallback for an account that hasn't been indexed in OpenSearch yet. Needed for
            // rendering accounts in the suggested sidebar which haven't been indexed yet.
            if (entityId.startsWith("Account:")) {
                const accountId = entityId.slice(8);
                assert(isId<AccountId>(accountId));

                const account = await getAccount(context, spaceId, accountId, {
                    consistency: "Strong",
                });

                return {
                    isPrivate: false,
                    id: entityId,
                    spaceId,
                    title: account.initialData.name,
                    titleVersion: {type: "Integer", version: account.initialData.nameVersion},
                    media: {type: "Account", account},
                };
            }

            return null;
        }

        // If we couldn't a specific search entity that might be because the search entity
        // hasn't been indexed in OpenSearch yet. Document indexing, for example, is
        // throttled since updates to a document happen many times per minute (even once
        // per keystroke). That means right after a document is created it won't show up in
        // the OpenSearch index until the throttled indexing job runs (10s throttle +
        // indexing time).
        //
        // Instead of not showing the document to the user in a mention or in the author's
        // search affinity list (which would be a very bad UX since how else will the user
        // find documents they just created but accidentally navigated away from?) we read
        // the document from DynamoDB (where the document will definitely exist) if the
        // document is not found in the OpenSearch index.
        //
        // If the entity WAS found in the OpenSearch index but its access policy doesn't
        // allow us to read it then we don't check DynamoDB since we expect the same
        // result.
        return fallbackGetSearchEntityBaseIfPossible(
            // Expect strong read consistency since if we can't find the entity in OpenSearch
            // that implies it was just created so we're running the risk of eventual
            // consistency lag anyway.
            context.dynamo.expectStrongReadConsistency(),
            spaceId,
            entityId,
            seen,
        );
    }

    const accessPolicy: {
        accountGrantById: Map<AccountId, AccessPolicyAccountGrantWithoutGeneration>;
        defaultGrant: AccessPolicyDefaultGrantWithoutGeneration | null;
        urlGrant: AccessPolicyUrlGrant | null;
    } = {
        accountGrantById: new Map(),
        defaultGrant: null,
        urlGrant: null,
    };

    if (doc.fields["accessPolicy.defaultGrantType"]?.[0] === "Space") {
        accessPolicy.defaultGrant = {level: "View"};
    }

    if (doc.fields["accessPolicy.accountGrantAccountIds"]) {
        for (const accountId of doc.fields["accessPolicy.accountGrantAccountIds"]) {
            accessPolicy.accountGrantById.set(accountId, {level: "View"});
        }
    }

    if (doc.fields["accessPolicy.urlGrantLevel"]?.[0] === "View") {
        accessPolicy.urlGrant = {level: "View"};
    }

    switch (context.actor.type) {
        // Optimization: For session actors don't run `evaluateAccessPolicy()`. We can
        // simply check whether the account is in `accountGrantAccountIds` (or the entity
        // is shared with the space).
        case "Session":
        case "ImpersonatedAccount": {
            if (accessPolicy.urlGrant?.level === "View") {
                break;
            }

            const isAccountMemberOfSpace = await isAccountMemberOfSpaceWithoutAuthorization(
                context,
                spaceId,
                context.actor.getAccountId(),
            );

            const isAccessAuthorized =
                isAccountMemberOfSpace &&
                (accessPolicy.defaultGrant?.level === "View" ||
                    accessPolicy.accountGrantById.get(context.actor.getAccountId())?.level ===
                        "View");

            if (!isAccessAuthorized) {
                return {isPrivate: true};
            }

            break;
        }

        // For bot actors, run `evaluateAccessPolicy()`. In order to view a search entity
        // all accounts in the bot's scope must have view access to the entity.
        case "Bot": {
            const isAccessAuthorized = await evaluateAccessPolicy(
                // Reading from OpenSearch is inherently eventually consistent. OpenSearch data can
                // be stale by up to two minutes. Don't bother requiring DynamoDB reads to be
                // strongly consistent here.
                context.dynamo.unexpectStrongReadConsistency(),
                spaceId,
                accessPolicy,
                "View",
            );

            if (!isAccessAuthorized) {
                return {isPrivate: true};
            }

            break;
        }
        case "Anonymous": {
            // Optimization: For anonymous actors don't run `evaluateAccessPolicy()`. We can
            // simply check whether urlGrant is set.
            const isAccessAuthorized = accessPolicy.urlGrant?.level === "View";

            if (!isAccessAuthorized) {
                return {isPrivate: true};
            }

            break;
        }
        case "System": {
            const isAccessAuthorized = await authorizeSpaceAccessIfPossible(context, spaceId);

            if (!isAccessAuthorized.ok) {
                return {isPrivate: true};
            }

            break;
        }
        default:
            throw exhaustive(context.actor);
    }

    const title = doc.fields.title?.[0] ?? null;
    const titleVersion = doc.fields.titleVersion?.[0] ?? null;
    const docMedia = doc.fields.media?.[0] ?? null;

    const media = docMedia
        ? await prepareSearchEntityMediaForResult(context, spaceId, entityId, docMedia)
        : null;

    return {
        isPrivate: false,
        id: entityId,
        spaceId,
        title: prepareSearchEntityTitleForResult(context.actor.type, entityId, title, media),
        titleVersion,
        media,
    };
}

/**
 * Get `SearchEntityModel`s for the provided `SearchEntityId`. Accounts are
 * represented by `AccountModel` instead of `SearchEntityModel` so the client uses
 * `AccountRegistry` to normalize accounts instead of `SearchEntityRegistry`.
 */
export async function getSearchEntityIfPossible(
    context: ServerActionContext,
    spaceId: SpaceId,
    entityId: SearchDynamicEntityId,
): Promise<
    {isPrivate: false; entity: SearchEntityModel | AccountModel} | {isPrivate: true} | null
> {
    const entity = await getSearchEntityBaseIfPossible(context, spaceId, entityId);
    if (entity === null || entity.isPrivate === true) return entity;

    if (!isSearchEntityModelId(entity.id)) {
        // The only `SearchEntityId` which isn't a `SearchEntityModelId` is
        // `Account:${AccountId}`. Expect that account search entities always have an
        // account media object.
        assert(entity.media?.type === "Account");

        return {isPrivate: false, entity: entity.media.account};
    } else {
        return {
            isPrivate: false,
            entity: new SearchEntityModel({
                id: entity.id,
                title: entity.title,
                titleVersion: entity.titleVersion,
                media: entity.media,
            }),
        };
    }
}

/**
 * Get `SearchAffinityEntityModel`s for the provided `SearchAffinityEntityId`s.
 * Accounts are represented by `AccountModel` instead of `SearchEntityModel` so the
 * client uses `AccountRegistry` to normalize accounts instead of
 * `SearchEntityRegistry`.
 *
 * You load search entities in a batch since unlike DynamoDB, we don't
 * automatically batch reads to OpenSearch.
 */
export async function getSearchAffinityEntityIfPossible(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    entityId: SearchAffinityEntityId & SearchDynamicEntityId,
): Promise<
    {isPrivate: false; entity: SearchAffinityEntityModel | AccountModel} | {isPrivate: true} | null
> {
    const entity = await getSearchEntityBaseIfPossible(context, spaceId, entityId);
    if (entity === null || entity.isPrivate === true) return entity;

    if (!isSearchEntityModelId(entityId)) {
        // The only `SearchEntityId` which isn't a `SearchEntityModelId` is
        // `Account:${AccountId}`. Expect that account search entities always have an
        // account media object.
        assert(entity.media?.type === "Account");

        return {isPrivate: false, entity: entity.media.account};
    } else {
        return {
            isPrivate: false,
            entity: SearchAffinityEntityModel.new({
                id: entityId,
                title: entity.title,
                titleVersion: entity.titleVersion,
                media: entity.media,
            }),
        };
    }
}

/**
 * Get `SearchEntityModel`s for the provided `SearchMentionEntityId`s.
 *
 * Accounts are excluded from `SearchMentionEntityId`s (accounts are mentioned by
 * separate means) so we don't return `AccountModel` from this function.
 *
 * You load search entities in a batch since unlike DynamoDB, we don't
 * automatically batch reads to OpenSearch.
 */
export async function getSearchMentionEntityIfPossible(
    context: ServerActionContext,
    spaceId: SpaceId,
    entityId: SearchMentionEntityId,
    seen?: ReadonlySet<SearchEntityId>,
): Promise<ContentReferencesSearchEntity | null> {
    const entity = await getSearchEntityBaseIfPossible(context, spaceId, entityId, seen);
    if (entity === null || entity.isPrivate === true) return entity;

    return {
        isPrivate: false,
        entity: new SearchEntityModel({
            id: entity.id as SearchMentionEntityId,
            title: entity.title,
            titleVersion: entity.titleVersion,
            media: entity.media,
        }),
    };
}

/**
 * Get a list of search entities that are most meaningful to the actor. When the
 * actor interacts with objects in our system, we boost their affinity score for
 * that object. Affinity scores decay over time so we end up considering objects
 * the actor interacts with a lot recently as the most meaningful.
 *
 * Unlike other search functions this one doesn't provide a `queryText` filter. The
 * actor has the same set of affinitive entities regardless of what they're
 * currently searching for.
 *
 * Will return unique `SearchAffinityEntityResult`s. No two
 * `SearchAffinityEntityResult`s will have the same ID. Even across `results` and
 * `favoriteResults`. If an ID exists in `favoriteResults` then it won't exist in
 * `results` and vice versa.
 */
export async function searchByAffinity(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<{
    hasMoreFavoriteResults: boolean;
    favoriteResults: Array<SearchFavoriteEntityResultModel>;
    results: Array<SearchAffinityEntityResultModel>;
}> {
    const [, , spaceAccount] = await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't collect affinity points so searching by affinity doesn't make sense
        // for a bot.
        authorizeNotBotSpaceAccount(context, spaceId, context.actor.getAccountId()),

        // Should be reading data cached by `authorizeSpaceAccess()` so shouldn't add any
        // additional network requests.
        getSpaceAccount(context, spaceId, context.actor.getAccountId()).then(spaceAccount => {
            if (spaceAccount.state.type === "Active") return spaceAccount;

            // We may have an `InvitePending` cached space account in our space accounts cache.
            // So try again with strong consistency.
            return getSpaceAccount(context, spaceId, context.actor.getAccountId(), {
                consistency: "Strong",
            });
        }),
    ]);

    // Should be safe since `authorizeSpaceAccess()` should throw if our account is in
    // a non-`Active` state. And we also retry loading with strong consistency if we
    // find a non-active space account.
    assert(spaceAccount.state.type === "Active");

    // The number of affinity results to load. We don't let the client configure this
    // number since we cache this in the client's RPC cache which is keyed on the
    // entire input to the RPC.
    const limit = 30;

    // Get double the max number of favorites we need in case some aren't visible due
    // to not being accessible anymore (e.g. they were deleted or their access policy
    // changed).
    const favoritesLimit = searchShortcutFavoriteEntityMaxCount * 2;

    const [entities, favoriteEntities, additionalEntitiesForNewSpaceAccount, settings] =
        await runAllPromises([
            internalGetSearchAffinityEntities(context, {spaceId, limit}),
            internalGetSearchFavoriteEntities(context, {
                spaceId,
                // Get one more than `favoritesLimit` for determining if `hasMoreFavoriteResults`
                // should be true.
                limit: favoritesLimit + 1,
            }),

            // For the first minute after an account has been activated, we'll load some search
            // entities with strong consistency. Since right after the user joins a space we
            // don't want to show a suggested side bar that's missing some or all of our
            // welcome package entities due to eventual consistency lag.
            Date.now() - spaceAccount.state.activatedTime.getTime() < 60 * 1000
                ? internalGetUnorderedSearchAffinityEntitiesWithStrongReadConsistency(context, {
                      spaceId,
                      limit: spaceWelcomePackageSearchEntityMaxCount,
                  })
                : null,

            getSpaceAccountSettings(context, spaceId),
        ]);

    const favoriteEntityIds = new Set<SearchAffinityEntityId>();
    for (const favoriteEntity of favoriteEntities) favoriteEntityIds.add(favoriteEntity.entityId);

    // Merge `additionalEntitiesForNewSpaceAccount` into `entities`.
    if (additionalEntitiesForNewSpaceAccount) {
        const entityIds = new Set<SearchAffinityEntityId>();
        for (const entity of entities) entityIds.add(entity.entityId);

        let newEntityCount = 0;

        // If we haven't seen this entity at all yet, then add it to the array.
        for (const additionalEntity of additionalEntitiesForNewSpaceAccount) {
            if (
                !entityIds.has(additionalEntity.entityId) &&
                !favoriteEntityIds.has(additionalEntity.entityId)
            ) {
                newEntityCount++;
                entities.push(additionalEntity);
            }
        }

        // NOTE(calebmer, 2026-01-09): Log that helps us verify this fix is actually doing
        // something in production. I'm pretty sure this is fixing a real bug in production
        // but I haven't actually observed the bug or observed that this fixes the bug. The
        // log here will help us verify that there's indeed a bug and that this fix is
        // working.
        if (newEntityCount > 0) {
            context.tracer.log(
                "Probable eventual consistency lag when loading search entities by affinity",
                {common: {count: newEntityCount}},
            );
        }
    }

    const dynamicEntityIds = new Set<SearchAffinityEntityId & SearchDynamicEntityId>();

    let shouldSortFavoriteEntities = false;

    for (const entity of entities) {
        if (entity.entityId !== "TaskPersonal") {
            dynamicEntityIds.add(entity.entityId);
        }

        // Due to eventual consistency lag, we may see a favorited entity when querying our
        // affinity index (sorted by points) and not when querying our favorites index. Add
        // any favorites we find from our affinity index to the `favoriteEntities` array.
        if (entity.favoriteOrderKey && !favoriteEntityIds.has(entity.entityId)) {
            favoriteEntityIds.add(entity.entityId);

            shouldSortFavoriteEntities = true;

            favoriteEntities.push({
                entityId: entity.entityId,
                orderKey: entity.favoriteOrderKey,
            });
        }
    }

    // If we added a new entity to this array, sort it again so we make sure to have
    // entities in the right order.
    if (shouldSortFavoriteEntities)
        favoriteEntities.sort((a, b) => defaultCompareStrings(a.orderKey, b.orderKey));

    for (let i = 0; i < Math.min(favoriteEntities.length, favoritesLimit); i++) {
        const favoriteEntity = favoriteEntities[i]!;
        if (favoriteEntity.entityId !== "TaskPersonal") {
            dynamicEntityIds.add(favoriteEntity.entityId);
        }
    }

    const dynamicEntities = await runAllPromises(
        mapIterable(dynamicEntityIds, entityId =>
            getSearchAffinityEntityIfPossible(context, spaceId, entityId),
        ),
    );

    const dynamicEntityById = new Map<SearchEntityId, SearchAffinityEntityModel | AccountModel>();

    for (const entity of dynamicEntities) {
        if (entity !== null && !entity.isPrivate) {
            dynamicEntityById.set(entity.entity.getSearchEntityId(), entity.entity);
        }
    }

    let hasMoreFavoriteResults = favoriteEntities.length > favoritesLimit;
    const favoriteResultById = new Map<
        SearchAffinityEntityId,
        Replace<SearchFavoriteEntityResultModel, {score: number}>
    >();
    const results: Array<SearchAffinityEntityResultModel> = [];

    for (let i = 0; i < Math.min(favoriteEntities.length, favoritesLimit); i++) {
        const favoriteEntity = favoriteEntities[i]!;

        if (favoriteResultById.size >= settings.searchShortcutFavoriteEntityCount) {
            if (favoriteEntity.entityId === "TaskPersonal") {
                hasMoreFavoriteResults = true;
                break;
            } else {
                const entity = dynamicEntityById.get(favoriteEntity.entityId);

                if (entity) {
                    hasMoreFavoriteResults = true;
                    break;
                }
            }
        } else {
            let result: SearchFavoriteEntityResultModel;
            if (favoriteEntity.entityId === "TaskPersonal") {
                result = new SearchFavoriteEntityResultModel({
                    model: SearchAffinityEntityModel.new({
                        id: favoriteEntity.entityId,
                        title: searchStaticEntityById[favoriteEntity.entityId].title,
                        titleVersion: null,
                        media: null,
                    }),
                    score: 0,
                    favoriteOrderKey: favoriteEntity.orderKey,
                });
            } else {
                const dynamicEntity = dynamicEntityById.get(favoriteEntity.entityId);
                if (!dynamicEntity) continue;

                result = new SearchFavoriteEntityResultModel({
                    model: dynamicEntity,
                    score: 0,
                    favoriteOrderKey: favoriteEntity.orderKey,
                });
            }

            if (favoriteResultById.has(result.id)) {
                throw new InternalError("Expected favorite search entities to be unique");
            }

            favoriteResultById.set(result.id, result);
        }
    }

    const resultIds = new Set<SearchAffinityEntityId>();

    for (const entity of entities) {
        // If this entity was a favorite then set the correct affinity points value instead
        // of 0.
        const favoriteResult = favoriteResultById.get(entity.entityId);
        if (favoriteResult) {
            favoriteResult.score = entity.points;
            continue;
        }

        if (resultIds.has(entity.entityId) || favoriteResultById.has(entity.entityId)) {
            throw new InternalError("Expected search entities to be unique");
        }
        resultIds.add(entity.entityId);

        let result: SearchAffinityEntityResultModel;
        if (entity.entityId === "TaskPersonal") {
            result = new SearchAffinityEntityResultModel({
                model: SearchAffinityEntityModel.new({
                    id: entity.entityId,
                    title: searchStaticEntityById[entity.entityId].title,
                    titleVersion: null,
                    media: null,
                }),
                score: entity.points,
                favoriteOrderKey: entity.favoriteOrderKey,
            });
        } else {
            const dynamicEntity = dynamicEntityById.get(entity.entityId);
            if (!dynamicEntity) continue;

            result = new SearchAffinityEntityResultModel({
                model: dynamicEntity,
                score: entity.points,
                favoriteOrderKey: entity.favoriteOrderKey,
            });
        }

        results.push(result);
    }

    return {
        hasMoreFavoriteResults,
        favoriteResults: Array.from(favoriteResultById.values()),
        results,
    };
}

/**
 * Search for entities we'll turn into mentions. Mention search only matches the
 * title of entities and only returns a subset of "mentionable" entities.
 */
export async function searchMentionByKeywords(
    context: ServerSessionActionContext,
    {
        spaceId,
        queryText,
        limit,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
    },
): Promise<
    Array<{
        readonly score: number;
        readonly model: SearchEntityModel;
    }>
> {
    await authorizeSpaceAccess(context, spaceId);

    const {hits} = await context.opensearch.searchWithoutSource(SearchEntityKeywordIndex, spaceId, {
        size: limit,
        sort: [
            "_score",
            // If score is tied, put the newer entities first.
            {createdTime: {order: "desc", missing: "_last"}},
        ],
        storedFields: ["title", "titleVersion", "media"],
        query: {
            bool: {
                must: [
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                ...getManualMatchBoolPrefixOpensearchShouldQueryClauses({
                                    field: "title",
                                    query: queryText,
                                    // Fuzzy matching on 2gram or 3gram fields can lead to some odd results where,
                                    // because we're fuzzy matching two words, we end up matching a two word pair which
                                    // means something completely different. e.g. "my documents" matches "30 documents"
                                    // or "of documents". So we only fuzzy match on the 1gram field.
                                    fuzziness: "AUTO",
                                    // Reduce the number of fuzzy expansions.
                                    prefix_length: 1,
                                    boost: 1,
                                }),
                                {
                                    multi_match: {
                                        query: new OpensearchQueryValue(queryText),
                                        type: "most_fields",
                                        fields: ["title._2gram", "title._3gram"],
                                        fuzziness: 0,
                                        boost: 1,
                                    },
                                },
                            ],
                        },
                    },
                ],

                // Use filter context to only match content the user is allowed to see. The content
                // must be in our space and must grant access to the account. Either directly or
                // through a default grant.
                //
                // Query clauses in a filter context may be cached.
                // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
                filter: [
                    {term: {spaceId: new OpensearchQueryValue(spaceId)}},
                    {terms: {type: new OpensearchQueryValue(getSearchMentionEntityTypes())}},
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                {
                                    term: {
                                        "accessPolicy.accountGrantAccountIds":
                                            new OpensearchQueryValue(context.actor.getAccountId()),
                                    },
                                },
                                {
                                    term: {
                                        "accessPolicy.defaultGrantType": new OpensearchQueryValue(
                                            SearchEntityIndexDefaultGrantTypeIntegerMapping.into(
                                                "Space",
                                            ),
                                        ),
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    });

    if (hits.length === 0) return [];

    const maxScore = hits[0]!.score;
    const minScore = hits[hits.length - 1]!.score;
    const demotionScore = maxScore - minScore + 1;

    const results = await runAllPromises(
        hits.map(async hit => {
            assert(isSearchMentionEntityId(hit.id));

            const title = hit.fields.title?.[0] ?? null;
            const titleVersion = hit.fields.titleVersion?.[0] ?? null;
            const hitMedia = hit.fields.media?.[0] ?? null;

            const media = hitMedia
                ? await prepareSearchEntityMediaForResult(context, spaceId, hit.id, hitMedia)
                : null;

            return {
                score:
                    hit.score -
                    // Demote direct chat hits to the bottom of the list. Very rarely do you want a
                    // direct chat mention. But you probably somewhat often want room chat mentions.
                    //
                    // Our hacky way of detecting direct chats is checking whether `accountCount` is
                    // non-null. Room chats have a null `accountCount`.
                    (hit.id.startsWith("Chat:") &&
                    media?.type === "AccountPile" &&
                    media.accountCount !== null
                        ? demotionScore
                        : 0),

                model: new SearchEntityModel({
                    id: hit.id,
                    title: prepareSearchEntityTitleForResult(
                        context.actor.type,
                        hit.id,
                        title,
                        media,
                    ),
                    titleVersion,
                    media,
                }),
            };
        }),
    );

    // Re-sort by score in case we changed scores.
    results.sort((a, b) => b.score - a.score);

    return results;
}

function getChannelStandaloneSearchResult(channel: ChannelModel): {
    channel: ChannelPreviewModel;
    descriptionTextSnippet: string;
} {
    const descriptionContentSnippet = getContentSnippet(channel.description.doc.resolve(0), 3, {
        // `printContentSingleLineTextSnippet()` collapses newlines. So also consider
        // newlines to be collapsed when generating a snippet.
        ignoreLineBreaks: true,
    });

    const descriptionTextSnippet = printContentSingleLineTextSnippetForServer({
        doc: descriptionContentSnippet,
        references: channel.description.references,
    });

    return {
        channel: channel.asPreview(),
        descriptionTextSnippet,
    };
}

/**
 * Search all the channels in our space by name. This search is capable of fuzzy
 * matching when there's a typo and prefix matching the last word.
 *
 * On the client we boost channels an account has an affinity for.
 */
export async function searchChannelsByKeywords(
    context: ServerSessionActionContext,
    {
        spaceId,
        queryText,
        limit,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
    },
): Promise<
    Array<{
        channel: ChannelPreviewModel;
        descriptionTextSnippet: string;
    }>
> {
    await authorizeSpaceAccess(context, spaceId);

    const {hits} = await context.opensearch.searchWithoutSource(SearchEntityKeywordIndex, spaceId, {
        size: limit,
        sort: [
            "_score",
            // If score is tied, put the newer collections first.
            {createdTime: {order: "desc", missing: "_last"}},
        ],
        query: {
            bool: {
                must: [
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                ...getManualMatchBoolPrefixOpensearchShouldQueryClauses({
                                    field: "title",
                                    query: queryText,
                                    // Fuzzy matching on 2gram or 3gram fields can lead to some odd results where,
                                    // because we're fuzzy matching two words, we end up matching a two word pair which
                                    // means something completely different. e.g. "my documents" matches "30 documents"
                                    // or "of documents". So we only fuzzy match on the 1gram field.
                                    fuzziness: "AUTO",
                                    // Reduce the number of fuzzy expansions.
                                    prefix_length: 1,
                                    boost: 1,
                                }),
                                {
                                    multi_match: {
                                        query: new OpensearchQueryValue(queryText),
                                        type: "most_fields",
                                        fields: ["title._2gram", "title._3gram"],
                                        fuzziness: 0,
                                        boost: 1,
                                    },
                                },
                            ],
                        },
                    },
                ],

                // Use filter context to only match content the user is allowed to see. The content
                // must be in our space and must grant access to the account. Either directly or
                // through a default grant.
                //
                // Query clauses in a filter context may be cached.
                // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
                filter: [
                    {term: {spaceId: new OpensearchQueryValue(spaceId)}},
                    {term: {type: new OpensearchQueryValue("Channel")}},
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                {
                                    term: {
                                        "accessPolicy.accountGrantAccountIds":
                                            new OpensearchQueryValue(context.actor.getAccountId()),
                                    },
                                },
                                {
                                    term: {
                                        "accessPolicy.defaultGrantType": new OpensearchQueryValue(
                                            SearchEntityIndexDefaultGrantTypeIntegerMapping.into(
                                                "Space",
                                            ),
                                        ),
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    });

    const channels = await runAllPromises(
        hits.map(async hit => {
            // Could be an assert since we should filter out non-channels in our search.
            if (!hit.id.startsWith("Channel:")) return null;

            const channelId = hit.id.slice(8) as ChannelId;

            // Data in the search index may be stale and the account may have lost access to
            // the channel. Don't return the channel if the user lost access.
            const channelResult = await getChannelIfPossible(context, channelId);
            if (!channelResult) return null;
            if (!channelResult.ok) return null;

            const channel = channelResult.value.model;

            return getChannelStandaloneSearchResult(channel);
        }),
    );

    return channels.filter(isNonNullable);
}

/**
 * Search room chats in our space by name.
 *
 * This search:
 *
 * - Only returns room chats (never direct chats)
 * - Only returns chats all `contributorAccountIds` have contributed to
 */
export async function searchRoomChatsByKeywords(
    context: ServerSessionActionContext,
    {
        spaceId,
        queryText,
        limit,
        contributorIds,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
        contributorIds: ReadonlySet<AccountId>;
    },
): Promise<Array<SearchEntityModel>> {
    await authorizeSpaceAccess(context, spaceId);

    const {hits} = await context.opensearch.searchWithoutSource(SearchEntityKeywordIndex, spaceId, {
        storedFields: ["title", "titleVersion", "media"],
        size: limit,
        sort: [
            "_score",
            // If score is tied, put the newer collections first.
            {createdTime: {order: "desc", missing: "_last"}},
        ],
        query: {
            bool: {
                must: [
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                ...getManualMatchBoolPrefixOpensearchShouldQueryClauses({
                                    field: "title",
                                    query: queryText,
                                    // Fuzzy matching on 2gram or 3gram fields can lead to some odd results where,
                                    // because we're fuzzy matching two words, we end up matching a two word pair which
                                    // means something completely different. e.g. "my documents" matches "30 documents"
                                    // or "of documents". So we only fuzzy match on the 1gram field.
                                    fuzziness: "AUTO",
                                    // Reduce the number of fuzzy expansions.
                                    prefix_length: 1,
                                    boost: 1,
                                }),
                                {
                                    multi_match: {
                                        query: new OpensearchQueryValue(queryText),
                                        type: "most_fields",
                                        fields: ["title._2gram", "title._3gram"],
                                        fuzziness: 0,
                                        boost: 1,
                                    },
                                },
                            ],
                        },
                    },
                ],

                // Use filter context to only match content the user is allowed to see. The content
                // must be in our space and must grant access to the account. Either directly or
                // through a default grant.
                //
                // Query clauses in a filter context may be cached.
                // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
                filter: [
                    {term: {spaceId: new OpensearchQueryValue(spaceId)}},
                    {term: {type: new OpensearchQueryValue("Chat")}},

                    // Look for chats with the "room" tag to make sure we're only searching for chat
                    // rooms and not for direct chats.
                    {term: {tags: new OpensearchQueryValue("room")}},

                    // Room chat must have ALL the provided contributors to match.
                    ...(contributorIds.size > 0
                        ? [
                              {
                                  bool: {
                                      must: Array.from(contributorIds, contributorId => ({
                                          term: {
                                              anyContributorIds: new OpensearchQueryValue(
                                                  contributorId,
                                              ),
                                          },
                                      })),
                                  },
                              },
                          ]
                        : []),

                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                {
                                    term: {
                                        "accessPolicy.accountGrantAccountIds":
                                            new OpensearchQueryValue(context.actor.getAccountId()),
                                    },
                                },
                                {
                                    term: {
                                        "accessPolicy.defaultGrantType": new OpensearchQueryValue(
                                            SearchEntityIndexDefaultGrantTypeIntegerMapping.into(
                                                "Space",
                                            ),
                                        ),
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    });

    const chats = await runAllPromises(
        hits.map(async hit => {
            // Could be an assert since we should filter out non-chat entities in our search.
            if (!hit.id.startsWith("Chat:")) return null;

            const hitId = hit.id as `Chat:${ChatId}`;
            const hitMedia = hit.fields.media?.[0] ?? null;
            const hitTitle = hit.fields.title?.[0] ?? null;
            const hitTitleVersion = hit.fields.titleVersion?.[0] ?? null;

            const media = hitMedia
                ? await prepareSearchEntityMediaForResult(context, spaceId, hitId, hitMedia)
                : null;

            return new SearchEntityModel({
                id: hitId,
                title: prepareSearchEntityTitleForResult(
                    context.actor.type,
                    hitId,
                    hitTitle,
                    media,
                ),
                titleVersion: hitTitleVersion,
                media,
            });
        }),
    );

    return chats.filter(isNonNullable);
}

/**
 * Get a list of channels relevant to the session account. First we look at
 * channels the account has interacted with. If the user hasn't personally
 * interacted with enough channels to fill `limit` then we'll return a list of the
 * most popular channels across the entire space.
 *
 * If it's a personal recommendation we return `origin: "Account"`. If it's a
 * space-wide recommendation we return `origin: "Space"`. Only personal
 * recommendations should be used to boost keyword search results.
 */
export async function searchChannelsByAffinity(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<{
        channel: ChannelPreviewModel;
        descriptionTextSnippet: string;
        origin: "Account" | "Space";
    }>
> {
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't collect affinity points so searching by affinity doesn't make sense
        // for a bot.
        authorizeNotBotSpaceAccount(context, spaceId, context.actor.getAccountId()),
    ]);

    const channelIdsFromAccountAffinities = await getPossiblyStaleChannelSearchAffinityEntityIds(
        context,
        spaceId,
    );

    if (channelIdsFromAccountAffinities.length >= limit) {
        const channels = await runAllPromises(
            channelIdsFromAccountAffinities.slice(0, limit).map(async channelId => {
                const channelResult = await getChannelIfPossible(context, channelId);
                if (!channelResult) return null;
                if (!channelResult.ok) return null;
                return {
                    ...getChannelStandaloneSearchResult(channelResult.value.model),
                    origin: "Account" as const,
                };
            }),
        );
        return channels.filter(isNonNullable);
    }

    const channelIdsFromAccountAffinitiesSet = new Set(channelIdsFromAccountAffinities);

    const channelIdsFromSpaceAffinities =
        await internalDangerouslyGetSpaceChannelSearchAffinityEntities(context, {
            spaceId,
            // Load 10 extra channels since some space-level channels might be private. We load
            // a full `limit` worth of items since there may be duplicates with channel IDs
            // from account affinities.
            limit: limit + 10,
        });

    const channels = await runAllPromises(
        [
            ...channelIdsFromAccountAffinities,
            ...channelIdsFromSpaceAffinities.filter(
                channelId => !channelIdsFromAccountAffinitiesSet.has(channelId.item.channelId),
            ),
        ].map(async channelId => {
            const channelResult = await getChannelIfPossible(
                context,
                typeof channelId === "string" ? channelId : channelId.item.channelId,
            );
            if (!channelResult) return null;
            if (!channelResult.ok) return null;
            return {
                ...getChannelStandaloneSearchResult(channelResult.value.model),
                origin: typeof channelId === "string" ? ("Account" as const) : ("Space" as const),
            };
        }),
    );

    return channels.filter(isNonNullable).slice(0, limit);
}

/**
 * Search all the task collections in our space by name. This search is capable of
 * fuzzy matching when there's a typo and prefix matching the last word.
 *
 * On the client we boost collections an account has an affinity for.
 */
export async function searchTaskCollectionsByKeywords(
    context: ServerSessionActionContext,
    {
        spaceId,
        queryText,
        limit,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
    },
): Promise<Array<TaskCollectionModelSearchResult & {readonly score: number}>> {
    await authorizeSpaceAccess(context, spaceId);

    const {hits} = await context.opensearch.searchWithoutSource(SearchEntityKeywordIndex, spaceId, {
        size: limit,
        sort: [
            "_score",
            // If score is tied, put the newer collections first.
            {createdTime: {order: "desc", missing: "_last"}},
        ],
        query: {
            bool: {
                must: [
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                ...getManualMatchBoolPrefixOpensearchShouldQueryClauses({
                                    field: "title",
                                    query: queryText,
                                    // Fuzzy matching on 2gram or 3gram fields can lead to some odd results where,
                                    // because we're fuzzy matching two words, we end up matching a two word pair which
                                    // means something completely different. e.g. "my documents" matches "30 documents"
                                    // or "of documents". So we only fuzzy match on the 1gram field.
                                    fuzziness: "AUTO",
                                    // Reduce the number of fuzzy expansions.
                                    prefix_length: 1,
                                    boost: 1,
                                }),
                                {
                                    multi_match: {
                                        query: new OpensearchQueryValue(queryText),
                                        type: "most_fields",
                                        fields: ["title._2gram", "title._3gram"],
                                        fuzziness: 0,
                                        boost: 1,
                                    },
                                },
                            ],
                        },
                    },
                ],

                // Use filter context to only match content the user is allowed to see. The content
                // must be in our space and must grant access to the account. Either directly or
                // through a default grant.
                //
                // Query clauses in a filter context may be cached.
                // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
                filter: [
                    {term: {spaceId: new OpensearchQueryValue(spaceId)}},
                    {term: {type: new OpensearchQueryValue("TaskCollection")}},
                    {
                        bool: {
                            minimum_should_match: 1,
                            should: [
                                {
                                    term: {
                                        "accessPolicy.accountGrantAccountIds":
                                            new OpensearchQueryValue(context.actor.getAccountId()),
                                    },
                                },
                                {
                                    term: {
                                        "accessPolicy.defaultGrantType": new OpensearchQueryValue(
                                            SearchEntityIndexDefaultGrantTypeIntegerMapping.into(
                                                "Space",
                                            ),
                                        ),
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
    });

    const collections = await runAllPromises(
        hits.map(async hit => {
            // Could be an assert since we should filter out non-collections in our search.
            if (!hit.id.startsWith("TaskCollection:")) return null;

            const collectionId = hit.id.slice(15) as TaskCollectionId;

            const result = await getTaskCollectionSearchResultIfPossible(context, collectionId);
            if (!result) return null;
            if (!result.ok) return null;
            return {...result.value, score: hit.score};
        }),
    );

    return collections.filter(isNonNullable);
}

/**
 * Get a list of task collections relevant to the session account. First we look at
 * collections the account has interacted with. If the user hasn't personally
 * interacted with enough collections to fill `limit` then we'll return a list of
 * the most popular collections across the entire space.
 *
 * If it's a personal recommendation we return `origin: "Account"`. If it's a
 * space-wide recommendation we return `origin: "Space"`. Only personal
 * recommendations should be used to boost keyword search results.
 */
export async function searchTaskCollectionsByAffinity(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<
        TaskCollectionModelSearchResult & {
            origin: "Account" | "Space";
        }
    >
> {
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't collect affinity points so searching by affinity doesn't make sense
        // for a bot.
        authorizeNotBotSpaceAccount(context, spaceId, context.actor.getAccountId()),
    ]);

    const collectionIdsFromAccountAffinities =
        await getPossiblyStaleTaskCollectionSearchAffinityEntityIds(context, spaceId);

    if (collectionIdsFromAccountAffinities.length >= limit) {
        const collections = await runAllPromises(
            collectionIdsFromAccountAffinities.slice(0, limit).map(async collectionId => {
                const result = await getTaskCollectionSearchResultIfPossible(context, collectionId);
                if (!result) return null;
                if (!result.ok) return null;
                return {...result.value, origin: "Account" as const};
            }),
        );
        return collections.filter(isNonNullable);
    }

    const collectionIdsFromAccountAffinitiesSet = new Set(collectionIdsFromAccountAffinities);

    const collectionIdsFromSpaceAffinities =
        await internalDangerouslyGetSpaceTaskCollectionSearchAffinityEntities(context, {
            spaceId,
            // Load 10 extra collections since some space-level collections might be private.
            // We load a full `limit` worth of items since there may be duplicates with
            // collection IDs from account affinities.
            limit: limit + 10,
        });

    const collections = await runAllPromises(
        [
            ...collectionIdsFromAccountAffinities,
            ...collectionIdsFromSpaceAffinities.filter(
                channelId =>
                    !collectionIdsFromAccountAffinitiesSet.has(channelId.item.collectionId),
            ),
        ].map(async collectionId => {
            const result = await getTaskCollectionSearchResultIfPossible(
                context,
                typeof collectionId === "string" ? collectionId : collectionId.item.collectionId,
            );
            if (!result) return null;
            if (!result.ok) return null;

            return {
                ...result.value,
                origin:
                    typeof collectionId === "string" ? ("Account" as const) : ("Space" as const),
            };
        }),
    );

    return collections.filter(isNonNullable).slice(0, limit);
}

/**
 * Get all of the session actor's favorite search entities ordered by `OrderKey`.
 */
export async function getAllSearchFavoriteEntities(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<ReadonlyArray<SearchFavoriteEntityResultModel>> {
    await authorizeSpaceAccess(context, spaceId);

    const favoriteEntities = await internalGetSearchFavoriteEntities(context, {
        spaceId,
        limit: "All",
    });

    const entityIds: Array<SearchDynamicEntityId & SearchAffinityEntityId> = [];
    for (const favoriteEntity of favoriteEntities) {
        if (favoriteEntity.entityId === "TaskPersonal") continue;
        entityIds.push(favoriteEntity.entityId);
    }

    const entities = await runAllPromises(
        mapIterable(entityIds, entityId =>
            getSearchAffinityEntityIfPossible(context, spaceId, entityId),
        ),
    );

    const results: Array<SearchFavoriteEntityResultModel> = [];

    let entityIndex = 0;
    for (const favoriteEntity of favoriteEntities) {
        if (favoriteEntity.entityId === "TaskPersonal") {
            results.push(
                new SearchFavoriteEntityResultModel({
                    model: SearchAffinityEntityModel.new({
                        id: favoriteEntity.entityId,
                        title: searchStaticEntityById[favoriteEntity.entityId].title,
                        titleVersion: null,
                        media: null,
                    }),
                    score: 0,
                    favoriteOrderKey: assertExists(favoriteEntity.orderKey),
                }),
            );
        } else {
            const entity = entities[entityIndex++];
            if (!entity || entity.isPrivate) continue;

            assert(entity.entity.getSearchEntityId() === favoriteEntity.entityId);

            results.push(
                new SearchFavoriteEntityResultModel({
                    model: entity.entity,
                    score: 0,
                    favoriteOrderKey: favoriteEntity.orderKey,
                }),
            );
        }
    }

    return results;
}

type SearchAccessPolicyForBotOrSessionResponse<IndexType extends "Keyword" | "Semantic"> =
    IndexType extends "Keyword"
        ? OpensearchQueryClause<OpensearchIndexFlattenedKeysType<typeof SearchEntityKeywordIndex>>
        : OpensearchQueryClause<
              OpensearchIndexFlattenedKeysType<typeof SearchEntityEmbeddingChunkIndex>
          >;

async function getOpensearchActorAccessQueryClause<IndexType extends "Keyword" | "Semantic">(
    context: Context<ServerAccountActionContextModules>,
    spaceId: SpaceId,
    indexType: IndexType,
): Promise<SearchAccessPolicyForBotOrSessionResponse<IndexType>> {
    const accountGrantKeyBase = "accessPolicy.accountGrantAccountIds";
    const defaultGrantKeyBase = "accessPolicy.defaultGrantType";
    const keyPrefix = indexType === "Keyword" ? "" : "entity.";

    const accessPolicyKey = `${keyPrefix}${accountGrantKeyBase}`;
    const defaultGrantKey = `${keyPrefix}${defaultGrantKeyBase}`;

    if (context.actor.type !== "Bot") {
        return {
            bool: {
                minimum_should_match: 1,
                should: [
                    {
                        term: {
                            [accessPolicyKey]: new OpensearchQueryValue(
                                context.actor.getAccountId(),
                            ),
                        },
                    },
                    {
                        term: {
                            [defaultGrantKey]: new OpensearchQueryValue(
                                SearchEntityIndexDefaultGrantTypeIntegerMapping.into("Space"),
                            ),
                        },
                    },
                ],
            },
        };
    }

    const accessPolicy = await getBotAccessPolicy(context as ServerBotActionContext);

    // Check if bot has space-level access (defaultGrant)
    if (accessPolicy.defaultGrant !== null) {
        return {
            term: {
                [defaultGrantKey]: new OpensearchQueryValue(
                    SearchEntityIndexDefaultGrantTypeIntegerMapping.into("Space"),
                ),
            },
        };
    } else if (accessPolicy.accountGrantById.size > 0) {
        const accountIds: Array<AccountId> = [];
        for (const accountId of accessPolicy.accountGrantById.keys()) {
            if (await isBotSpaceAccount(context, spaceId, accountId)) continue;
            accountIds.push(accountId);
        }

        // Create a must clause for each account ID to ensure ALL are present
        const mustClauses: Array<
            OpensearchQueryClause<
                OpensearchIndexFlattenedKeysType<typeof SearchEntityEmbeddingChunkIndex>
            >
        > = accountIds.map(accountId => ({
            term: {
                [accessPolicyKey]: new OpensearchQueryValue(accountId),
            },
        }));

        return {
            bool: {
                minimum_should_match: 1,
                should: [
                    {bool: {must: mustClauses}},
                    {
                        term: {
                            [defaultGrantKey]: new OpensearchQueryValue(
                                SearchEntityIndexDefaultGrantTypeIntegerMapping.into("Space"),
                            ),
                        },
                    },
                ],
            },
        } as SearchAccessPolicyForBotOrSessionResponse<IndexType>;
    } else {
        throw new InternalError("Bot doesn\u2019t have an access policy defined for Search");
    }
}
