import {CalendarDate} from "@internationalized/date";
import {Node} from "prosemirror-model";
import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {
    getChatMessagePayload,
    putChatMessageStreamPart,
} from "~/server/chat/data/chat_messaging.js";
import {
    getChatDefinition,
    getChatDefinitionIfExists,
} from "~/server/chat/data/get_chat_definition.js";
import {hasChatMessages} from "~/server/chat/data/get_chat_message_count.js";
import {getChatSearchEntityContributorIds} from "~/server/chat/data/get_chat_search_entity_contributor_ids.js";
import {getRoomChatPreviewAccountIds} from "~/server/chat/data/get_room_chat_preview_account_ids.js";
import {
    ServerActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {
    DocumentStepCountByAccountId,
    getDocumentCommentPayload,
    getDocumentContent,
    getDocumentTitleIfExists,
    putDocumentCommentStreamPart,
} from "~/server/documents/data/documents_actions.js";
import {getFileIfExistsAsSystem} from "~/server/files/data/files_actions.js";
import {getChannelNameAndDescriptionContentAndContributors} from "~/server/forum/data/get_channel_name_and_description_content_and_contributors.js";
import {getChannelPreviewIfExists} from "~/server/forum/data/get_channel_preview.js";
import {
    getPostContentAndChannelPreview,
    getPostContentAndChannelPreviewIfExists,
} from "~/server/forum/data/get_post_content_and_channel_preview.js";
import {maxChannelContributionCount} from "~/server/forum/data/max_channel_contribution_count.js";
import {
    getPostCommentPayload,
    putPostCommentStreamPart,
} from "~/server/forum/data/post_messaging.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {messageStreamTimeoutMs} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {
    SearchEntityDependencyId,
    isSearchEntityDependencyIdAlsoEntityId,
    isSearchEntityIdAlsoEntityDependencyId,
} from "~/server/search/core/search_entity_dependency_id.js";
import {searchEntityMajorContributorCutOff} from "~/server/search/core/search_entity_major_contributor_cut_off.js";
import {chunkSearchContent} from "~/server/search/data/index/internal/chunk_search_content.js";
import {
    prepareSearchDirectChatEntityTitleForResult,
    searchChatEntityResultTitlePreviewAccountCount,
} from "~/server/search/data/index/internal/prepare_search_chat_entity_title_for_result.js";
import {
    SearchEntityIndexAccessPolicy,
    SearchEntityIndexDefaultGrantType,
} from "~/server/search/data/index/internal/search_entity_index_doc.js";
import {SearchEntityMedia} from "~/server/search/data/index/internal/search_entity_media.js";
import {truncateTokens} from "~/server/search/data/index/internal/truncate_tokens.js";
import {getAccount, getAccountIfExists} from "~/server/spaces/get_account.js";
import {
    getTaskCollectionFromIndex,
    getTaskCollectionFromIndexIfExists,
    getTaskFromIndex,
    getTaskFromIndexIfExists,
} from "~/server/tasks/data/task_index.js";
import {TaskApproximateActionCountByAccountId} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskStepCountByAccountId,
    getTaskCommentPayload,
    getTaskNotesContentWithoutReferences,
    putTaskCommentStreamPart,
} from "~/server/tasks/data/task_table.js";
import {AccessLevel, AccessPolicy, hasAccessLevel} from "~/shared/access/access_policy.js";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {defaultAgentErrorDisplayMessage} from "~/shared/agents/default_agent_error_text.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
    emptyMessageContent,
} from "~/shared/content/message_content_schema.js";
import {RenderContentMentionToTextSearchEntity} from "~/shared/content/render_content_mention_to_text.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {DocumentCreatorFrom} from "~/shared/documents/document_creator_from.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {InternalError, NotFoundError} from "~/shared/error/error.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {
    createPostSearchEntityTitle,
    createPostSearchEntityTitleWithAlreadySnippedContent,
    getPostSearchEntityTitleContentSnippet,
} from "~/shared/forum/create_post_search_entity_title.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {stableShuffleArray} from "~/shared/helpers/array/stable_shuffle_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {addToIterable} from "~/shared/helpers/iterable/add_to_iterable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {
    MessagePayload,
    MessageStream,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
import {
    SearchDynamicEntityId,
    SearchDynamicEntityIdObject,
    SearchEntityId,
    SearchMentionEntityId,
    parseSearchMentionEntityId,
    printSearchDynamicEntityId,
} from "~/shared/search/search_entity_id.js";
import {SearchEntityTitleVersion} from "~/shared/search/search_entity_title_version.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {getTaskCollectionSearchEntityBase} from "~/shared/tasks/get_task_collection_search_entity_base.js";
import {getTaskSearchEntityBase} from "~/shared/tasks/get_task_search_entity_base.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskTitleModel, addFallbackToTaskTitle} from "~/shared/tasks/title/task_title.js";

export type SearchEntity = {
    readonly id: SearchDynamicEntityId;
    readonly accessPolicy: SearchEntityIndexAccessPolicy;
    readonly createdTime: Date | null;
    readonly title: string | null;
    readonly titleVersion: SearchEntityTitleVersion | null;
    readonly body: string | null;
    readonly tags: ReadonlyArray<string>;
    readonly media: SearchEntityMedia | null;
    readonly embeddingChunks: ReadonlyArray<SearchEntityEmbeddingChunk>;
    readonly dueDate: CalendarDate | null;
    readonly assigneeId: AccountId | null;
    readonly priority: TaskPriority | null;

    // Generic stateful properties that an entity may have. It's up to each entity to
    // decide what these mean, and how they'll be relevant to a search.
    readonly openness: "Open" | "Closed" | null;
    readonly activeness: "Active" | "Inactive" | null;

    // The creator is the account which created the entity. `contributorIds` are the
    // accounts which updated the entity. Contributors with value `Major` are accounts
    // that contributed more than 20% of updates to the entity. Contributors with value
    // `Minor` are accounts that contributed less than 20% of updates. We pick 20% as
    // the cutoff point based on a loose application of the [pareto principle][1] (80%
    // of the entity's meaning comes from at least 20% of the updates).
    //
    // An account may be both a creator and contributor. For example, the creator of a
    // document may not be the major contributor. If there will never be more than one
    // contributor (the creator, e.g. a chat message) than `contributorIds` will be
    // empty.
    //
    // [1]: https://en.wikipedia.org/wiki/Pareto_principle
    readonly creatorId: AccountId | null;
    readonly contributorIds: ReadonlyMap<AccountId, "Major" | "Minor">;
};

export type SearchEntityEmbeddingChunk = {
    readonly preambleEndIndex: number;
    readonly tokenCountWithoutPreamble: number;
    readonly text: string;
};

/**
 * The search entity to use for deleted messages. We don't keep anything around in
 * the search index for deleted messages. Since unlike deleted tasks or documents
 * you can't mention a message and messages don't show up in our trash feature.
 */
// NOTE(calebmer, 2025-11-06): Eventually we should have a trash feature for
// recovering deleted tasks, task collections, documents, or anything else the user
// might delete. Right now my idea for implementing trash is it's based on the
// OpenSearch index. So we continue to maintain `accessPolicy`s and some other
// metadata for deleted entities so they can be searched.
const searchDeletedMessageEntity: Omit<SearchEntity, "id"> = {
    accessPolicy: {accountGrantAccountIds: emptySet, defaultGrantType: null, urlGrantLevel: null},
    createdTime: null,
    title: null,
    titleVersion: null,
    body: null,
    tags: emptyArray,
    media: null,
    embeddingChunks: [],
    creatorId: null,
    contributorIds: emptyMap,
    dueDate: null,
    assigneeId: null,
    priority: null,
    openness: null,
    activeness: null,
};

/**
 * For reference "The quick brown fox jumps over the lazy dog" is 9 tokens. "How
 * we're designing our personal task management product" is 10 tokens. 32 tokens
 * (16 tokens for title, 16 tokens for section heading) is ~6% of our 512 token
 * window for Cohere's embedding models.
 *
 * 16 tokens feels like a good balance between fitting titles without taking up too
 * much space.
 */
const searchEntityEmbeddingPreambleTitleTokenCount = 16;

/**
 * Data on a `TaskModel` that influences who has access. Use this interface if
 * you're recording a dependency only on a task's `Authorization` trait.
 */
interface TaskModelForAuthorization {
    isDeleted(): boolean;
    getCreator(): {readonly accountId: AccountId};
    getAssignee(): {readonly assignee: {readonly accountId: AccountId}} | null;
    getParent(): {readonly taskId: TaskId} | null;
    getCollections(): {getArray(): ReadonlyArray<{readonly collectionId: TaskCollectionId}>};
    getAccessPolicy(): AccessPolicy;
}

/**
 * Data on a `TaskCollectionModel` that influences who has access. Use this
 * interface if you're recording a dependency only on a collection's
 * `Authorization` trait.
 */
interface TaskCollectionModelForAuthorization {
    readonly id: TaskCollectionId;
    isDeleted(): boolean;
    getAccessPolicy(): AccessPolicy;
    getNameAndRecordDependency(): string;
}

/**
 * Object that controls reading of a search entity. The implementations of
 * `getSearchEntity()` for each entity type (e.g. `getDocumentSearchEntity()`) do
 * not have access to a full context object! Instead, all reads must go through
 * this class which:
 *
 * 1. Tracks all dependencies read by the `getSearchEntity()` function
 * 2. Makes sure all reads use strong consistency
 *
 * It's really important that all reads use strong consistency. Or else we might
 * miss an update while executing our search indexing job. For example, say you
 * just updated your chat message. We queue an indexing job which reads the chat
 * message back. If we read the chat message with eventual consistency we might get
 * the chat message's data from before your update.
 */
class SearchEntityReadState {
    private readonly _context: ServerSystemActionContext;
    public readonly tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
    public readonly registerAdditionalWrite: (
        action: (context: ServerSystemActionContext) => Promise<void>,
    ) => void;
    private readonly _targetId: SearchDynamicEntityId;

    private readonly _dependencyIds = new Set<SearchEntityDependencyId>();

    // Cache of accounts so if an account is mentioned multiple times we don't need to
    // load it multiple times. We can't use the built-in `getAccount()` cache because
    // we need to read with strong consistency.
    //
    // It's ok to cache within the context of read state because we need strongly
    // consistent reads after construction of read state. If we pick up an account from
    // the `getAccount()` cache we don't have that guarantee.
    private readonly _accountPromiseById = new Map<
        AccountId,
        Promise<AccountModelWithoutSpaceData | null>
    >();

    constructor(
        context: ServerSystemActionContext,
        targetId: SearchDynamicEntityId,
        {
            tokenizer,
            registerAdditionalWrite,
        }: {
            tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
            registerAdditionalWrite: (
                action: (context: ServerSystemActionContext) => Promise<void>,
            ) => void;
        },
    ) {
        // Makes sure all reads use strong consistency. We need strong consistency so that
        // we don't miss recent updates when indexing. Throws an error (in development) if
        // a read doesn't use strong consistency.
        this._context = context.dynamo.expectStrongReadConsistency();

        this.tokenizer = tokenizer;
        this.registerAdditionalWrite = registerAdditionalWrite;
        this._targetId = targetId;
    }

    /**
     * Record a dependency of the target search entity. Must be called whenever we read
     * data for this entity.
     *
     * You can't take a dependency on every entity type. Some entity types, as an
     * optimization, we disallow taking as a dependency since it allows us to skip
     * checking for dependent updates when that entity changes.
     *
     * For example, no entity depends on `ChatMessage`.
     */
    private _recordDependencyId(id: SearchDynamicEntityId | SearchEntityDependencyId) {
        if (isSearchEntityDependencyIdAlsoEntityId(id)) {
            // We implicitly depend on the target.
            if (id === this._targetId) return;

            if (!isSearchEntityIdAlsoEntityDependencyId(id)) {
                throw new InternalError(
                    quote`Search entity type is not currently supported as a dependency: ${id.slice(
                        0,
                        id.indexOf(":"),
                    )}`,
                );
            }

            this._dependencyIds.add(id);
        } else {
            // We implicitly depend on the target.
            if (id.startsWith(this._targetId)) return;

            this._dependencyIds.add(id);
        }
    }

    public getDependencyIds(): ReadonlySet<SearchEntityDependencyId> {
        return this._dependencyIds;
    }

    /**
     * Get an account by `AccountId`. Returns `AccountModelWithoutSpace` instead of
     * `AccountModel` so that if space properties change (e.g. account is removed or
     * account permission level changes) we don't need to re-index all content that
     * references the account.
     */
    // Arrow function form so we can pass as a function parameter (e.g.
    // `chunkSearchContent(content, {getAccountIfExists: state.getAccountIfExists}))`)
    public getAccountIfExists(accountId: AccountId): Promise<AccountModelWithoutSpaceData | null> {
        this._recordDependencyId(`Account:${accountId}:WithoutSpace`);

        return getOrSetDefaultMapValue(this._accountPromiseById, accountId, async () => {
            const account = await getAccountIfExists(
                this._context,
                this._context.actor.getSpaceId(),
                accountId,
                {consistency: "Strong"},
            );
            if (!account) return null;

            return omitObject(account.initialData, ["space"]);
        });
    }

    public async getAccount(accountId: AccountId): Promise<AccountModelWithoutSpaceData> {
        const account = await this.getAccountIfExists(accountId);
        if (!account) throw new NotFoundError("Account not found");
        return account;
    }

    public async getAccountWithSpace(accountId: AccountId): Promise<AccountModel> {
        this._recordDependencyId(`Account:${accountId}`);

        return getAccount(this._context, this._context.actor.getSpaceId(), accountId, {
            consistency: "Strong",
        });
    }

    public async getFileContentTypeIfExists(fileId: FileId): Promise<FileContentType | null> {
        // We don't need to record a dependency on the file since file types never change!
        // Files are immutable. We'll never need to reindex.
        const file = await getFileIfExistsAsSystem(this._context, fileId, {
            consistency: "StrongWithinCache",
        });

        if (!file) return null;
        return file.contentType;
    }

    public getDocumentContent(documentId: DocumentId): Promise<{
        createdTime: Date;
        version: number;
        content: DocumentContent;
        creator: {
            id: AccountId | null;
            from: DocumentCreatorFrom | null;
        };
        stepCountByNonCreatorAccountId: DocumentStepCountByAccountId;
        updateContentPreview: (context: ServerActionContext) => Promise<void>;
    }> {
        this._recordDependencyId(`Document:${documentId}`);

        return getDocumentContent(this._context, documentId, {
            consistency: "StrongWithinCache",
        });
    }

    public getDocumentTitleIfExists(documentId: DocumentId): Promise<{
        title: string;
        accessPolicy: AccessPolicy;
    } | null> {
        this._recordDependencyId(`Document:${documentId}:Authorization`);
        this._recordDependencyId(`Document:${documentId}:Title`);

        return getDocumentTitleIfExists(this._context, documentId, {
            consistency: "StrongWithinCache",
        });
    }

    public async getDocumentCommentPayload(
        documentId: DocumentId,
        commentThreadId: DocumentCommentThreadId,
        commentIndex: number,
    ): Promise<{
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
        stream: (MessageStream & {readonly lastPingTime: Date | null}) | null;
        documentAccessPolicy: AccessPolicy;
    }> {
        this._recordDependencyId(`Document:${documentId}:Authorization`);
        this._recordDependencyId(
            `DocumentComment:${documentId}-${commentThreadId}-${commentIndex}`,
        );

        const comment = await getDocumentCommentPayload(this._context, {
            documentId,
            commentThreadId,
            commentIndex,
            consistency: "StrongWithinCache",
        });

        return {
            ...comment,
            payload: mergeMessageItemStreamIntoPayload(comment),
        };
    }

    public getChannelNameAndDescriptionContentAndContributors(channelId: ChannelId): Promise<{
        version: number;
        name: string;
        description: MessageContent;
        createdTime: Date;
        creatorId: AccountId | null;
        accessPolicy: AccessPolicy;
        contributionCountByAccountId: ReadonlyMap<AccountId, number>;
    }> {
        this._recordDependencyId(`Channel:${channelId}`);

        return getChannelNameAndDescriptionContentAndContributors(this._context, channelId, {
            consistency: "StrongWithinCache",
        });
    }

    public getChannelPreviewIfExists(channelId: ChannelId): Promise<{
        name: string;
        accessPolicy: AccessPolicy;
    } | null> {
        this._recordDependencyId(`Channel:${channelId}:Authorization`);
        this._recordDependencyId(`Channel:${channelId}:Preview`);

        return getChannelPreviewIfExists(this._context, channelId, {
            consistency: "StrongWithinCache",
        });
    }

    /**
     * When we load a post, we also load the channel the post is in. This marks the
     * channel as a dependency of our search entity.
     *
     * A post inherits permissions from its channel. We also use the channel name to
     * provide context in the post's embedding chunk.
     */
    public async getPostContentAndChannel(postId: PostId): Promise<{
        version: number;
        createdTime: Date;
        authorId: AccountId;
        content: PostContent;
        channel: ChannelPreviewModel;
    }> {
        this._recordDependencyId(`Post:${postId}`);

        const contentAndChannel = await getPostContentAndChannelPreview(this._context, postId, {
            consistency: "StrongWithinCache",
        });

        // If the access policy on the channel changes we need to re-index posts so they
        // have the new access policy.
        this._recordDependencyId(`Channel:${contentAndChannel.channel.id}:Authorization`);
        this._recordDependencyId(`Channel:${contentAndChannel.channel.id}:Preview`);

        return contentAndChannel;
    }

    public async getPostContentTitleSnippetAndChannelIfExists(postId: PostId): Promise<{
        version: number;
        createdTime: Date;
        authorId: AccountId;
        contentTitleSnippet: PostContent;
        channel: ChannelPreviewModel;
    } | null> {
        this._recordDependencyId(`Post:${postId}:Title`);

        const contentAndChannel = await getPostContentAndChannelPreviewIfExists(
            this._context,
            postId,
            {consistency: "StrongWithinCache"},
        );
        if (!contentAndChannel) return null;

        // If the access policy on the channel changes we need to re-index posts so they
        // have the new access policy.
        this._recordDependencyId(`Channel:${contentAndChannel.channel.id}:Authorization`);
        this._recordDependencyId(`Channel:${contentAndChannel.channel.id}:Preview`);

        return {
            version: contentAndChannel.version,
            createdTime: contentAndChannel.createdTime,
            authorId: contentAndChannel.authorId,
            contentTitleSnippet: getPostSearchEntityTitleContentSnippet(contentAndChannel.content),
            channel: contentAndChannel.channel,
        };
    }

    public async getPostCommentPayload(
        postId: PostId,
        commentIndex: number,
    ): Promise<{
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
        stream: (MessageStream & {readonly lastPingTime: Date | null}) | null;
        channelId: ChannelId;
        channelAccessPolicy: AccessPolicy;
    }> {
        this._recordDependencyId(`PostComment:${postId}-${commentIndex}`);

        const comment = await getPostCommentPayload(this._context, {
            postId,
            commentIndex,
            consistency: "StrongWithinCache",
        });

        this._recordDependencyId(`Channel:${comment.channelId}:Authorization`);

        return {
            ...comment,
            payload: mergeMessageItemStreamIntoPayload(comment),
        };
    }

    public async getTaskCommentPayload(
        taskId: TaskId,
        commentIndex: number,
    ): Promise<{
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
        stream: (MessageStream & {readonly lastPingTime: Date | null}) | null;
    }> {
        this._recordDependencyId(`TaskComment:${taskId}-${commentIndex}`);

        const comment = await getTaskCommentPayload(this._context, {
            taskId,
            commentIndex,
            consistency: "StrongWithinCache",
        });

        return {
            ...comment,
            payload: mergeMessageItemStreamIntoPayload(comment),
        };
    }

    public getChatDefinitionAndMessagesSummary(chatId: ChatId): Promise<{
        version: number;
        createdTime: Date;
        definition:
            | {type: "Direct"; accountIds: ReadonlySet<AccountId>}
            | {type: "Room"; name: string; accessPolicy: AccessPolicy; creatorId: AccountId};
        messagesSummary: {
            unknownAuthorMessageCount: number;
            messageCountByAuthorId: ReadonlyMap<AccountId, number>;
        };
    }> {
        this._recordDependencyId(`Chat:${chatId}`);

        return getChatDefinition(this._context, chatId, {
            consistency: "StrongWithinCache",
        });
    }

    public async getChatDefinitionIfExists(
        chatId: ChatId,
    ): Promise<
        | {type: "Direct"; accountIds: ReadonlySet<AccountId>}
        | {type: "Room"; name: string; accessPolicy: AccessPolicy}
        | null
    > {
        this._recordDependencyId(`Chat:${chatId}:Definition`);

        const result = await getChatDefinitionIfExists(this._context, chatId, {
            consistency: "StrongWithinCache",
        });
        if (!result) return null;

        return result.definition;
    }

    public async getChatDefinition(
        chatId: ChatId,
    ): Promise<
        | {type: "Direct"; accountIds: ReadonlySet<AccountId>}
        | {type: "Room"; name: string; accessPolicy: AccessPolicy}
    > {
        this._recordDependencyId(`Chat:${chatId}:Definition`);

        const result = await getChatDefinition(this._context, chatId, {
            consistency: "StrongWithinCache",
        });

        return result.definition;
    }

    public async getChatMessagePayload(
        chatId: ChatId,
        messageIndex: number,
    ): Promise<{
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
        stream: (MessageStream & {readonly lastPingTime: Date | null}) | null;
    }> {
        this._recordDependencyId(`ChatMessage:${chatId}-${messageIndex}`);

        const message = await getChatMessagePayload(this._context, {
            chatId,
            messageIndex,
            consistency: "StrongWithinCache",
        });

        return {
            ...message,
            payload: mergeMessageItemStreamIntoPayload(message),
        };
    }

    public async getTask(taskId: TaskId): Promise<
        | {
              isDeleted: true;
              task: TaskModel;
              referencedTaskById: ReadonlyMap<TaskId, TaskModelForAuthorization>;
              referencedCollectionById: ReadonlyMap<
                  TaskCollectionId,
                  TaskCollectionModelForAuthorization
              >;
          }
        | {
              isDeleted: false;
              task: TaskModel;
              referencedTaskById: ReadonlyMap<TaskId, TaskModelForAuthorization>;
              referencedCollectionById: ReadonlyMap<
                  TaskCollectionId,
                  TaskCollectionModelForAuthorization
              >;
              approximateActionCountByAccountId: TaskApproximateActionCountByAccountId;
              notesContent: {
                  version: number;
                  content: TaskNotesContent;
                  stepCountByNonCreatorAccountId: TaskStepCountByAccountId;
              };
          }
    > {
        this._recordDependencyId(`Task:${taskId}`);

        const [
            {task, referencedTasks, referencedCollections, approximateActionCountByAccountId},
            notesContentResult,
        ] = await runAllPromises([
            getTaskFromIndex(this._context, this._context.actor.getSpaceId(), taskId),

            // We ignore any errors from loading notes if the task was deleted. Since loading
            // notes runs authorization and should throw a `NotFoundError`.
            captureResultPromise(
                getTaskNotesContentWithoutReferences(this._context, taskId, {
                    consistency: "StrongWithinCache",
                }),
            ),
        ]);

        const referencedTaskById = new Map<TaskId, TaskModel>(
            referencedTasks.map(task => {
                this._recordDependencyId(`Task:${task.id}:Authorization`);

                return [task.id, task];
            }),
        );

        const referencedCollectionById = new Map<
            TaskCollectionId,
            TaskCollectionModelForAuthorization
        >(
            referencedCollections.map(collection => {
                this._recordDependencyId(`TaskCollection:${collection.id}:Authorization`);

                // Wrap the collection model to automatically record `:Name` dependency when
                // `getName()` is called.
                const wrappedCollection: TaskCollectionModelForAuthorization = {
                    id: collection.id,
                    isDeleted: () => collection.isDeleted(),
                    getAccessPolicy: () => collection.getAccessPolicy(),
                    getNameAndRecordDependency: () => {
                        this._recordDependencyId(`TaskCollection:${collection.id}:Name`);
                        return collection.getName();
                    },
                };
                return [collection.id, wrappedCollection];
            }),
        );

        if (task.isDeleted()) {
            return {
                isDeleted: true,
                task,
                referencedTaskById,
                referencedCollectionById,
            };
        }

        return {
            isDeleted: false,
            task,
            referencedTaskById,
            referencedCollectionById,
            approximateActionCountByAccountId,
            notesContent: unwrapResult(notesContentResult),
        };
    }

    public async getTaskForAuthorization(taskId: TaskId): Promise<{
        task: TaskModelForAuthorization;
        getReferencedTaskById: () => ReadonlyMap<TaskId, TaskModelForAuthorization>;
        getReferencedCollectionById: () => ReadonlyMap<
            TaskCollectionId,
            TaskCollectionModelForAuthorization
        >;
    }> {
        this._recordDependencyId(`Task:${taskId}:Authorization`);

        const {task, referencedTasks, referencedCollections} = await getTaskFromIndex(
            this._context,
            this._context.actor.getSpaceId(),
            taskId,
        );

        const referencedTaskById = new Lazy(() => {
            return new Map<TaskId, TaskModel>(
                referencedTasks.map(task => {
                    this._recordDependencyId(`Task:${task.id}:Authorization`);

                    return [task.id, task];
                }),
            );
        });

        const referencedCollectionById = new Lazy(() => {
            return new Map<TaskCollectionId, TaskCollectionModelForAuthorization>(
                referencedCollections.map(collection => {
                    this._recordDependencyId(`TaskCollection:${collection.id}:Authorization`);

                    // Wrap the collection model to automatically record `:Name` dependency when
                    // `getName()` is called.
                    const wrappedCollection: TaskCollectionModelForAuthorization = {
                        id: collection.id,
                        isDeleted: () => collection.isDeleted(),
                        getAccessPolicy: () => collection.getAccessPolicy(),
                        getNameAndRecordDependency: () => {
                            this._recordDependencyId(`TaskCollection:${collection.id}:Name`);
                            return collection.getName();
                        },
                    };
                    return [collection.id, wrappedCollection];
                }),
            );
        });

        return {
            task,
            // Functions so we only record dependencies if we actually need to use them.
            getReferencedTaskById: () => referencedTaskById.get(),
            getReferencedCollectionById: () => referencedCollectionById.get(),
        };
    }

    public async getTaskTitleIfExists(taskId: TaskId): Promise<{
        title: TaskTitleModel;
        task: TaskModelForAuthorization;
        referencedTaskById: ReadonlyMap<TaskId, TaskModelForAuthorization>;
        referencedCollectionById: ReadonlyMap<
            TaskCollectionId,
            TaskCollectionModelForAuthorization
        >;
    } | null> {
        this._recordDependencyId(`Task:${taskId}:Authorization`);
        this._recordDependencyId(`Task:${taskId}:Title`);

        const taskResult = await getTaskFromIndexIfExists(
            this._context,
            this._context.actor.getSpaceId(),
            taskId,
        );
        if (!taskResult) return null;
        const {task, referencedTasks, referencedCollections} = taskResult;

        const referencedTaskById = new Map<TaskId, TaskModel>(
            referencedTasks.map(task => {
                this._recordDependencyId(`Task:${task.id}:Authorization`);

                return [task.id, task];
            }),
        );

        const referencedCollectionById = new Map<
            TaskCollectionId,
            TaskCollectionModelForAuthorization
        >(
            referencedCollections.map(collection => {
                this._recordDependencyId(`TaskCollection:${collection.id}:Authorization`);

                // Wrap the collection model to automatically record `:Name` dependency when
                // `getName()` is called.
                const wrappedCollection: TaskCollectionModelForAuthorization = {
                    id: collection.id,
                    isDeleted: () => collection.isDeleted(),
                    getAccessPolicy: () => collection.getAccessPolicy(),
                    getNameAndRecordDependency: () => {
                        this._recordDependencyId(`TaskCollection:${collection.id}:Name`);
                        return collection.getName();
                    },
                };
                return [collection.id, wrappedCollection];
            }),
        );

        return {
            title: task.getTitle(),
            task,
            referencedTaskById,
            referencedCollectionById,
        };
    }

    public async getTaskCollection(collectionId: TaskCollectionId): Promise<TaskCollectionModel> {
        this._recordDependencyId(`TaskCollection:${collectionId}`);

        const collection = await getTaskCollectionFromIndex(
            this._context,
            this._context.actor.getSpaceId(),
            collectionId,
        );

        return collection;
    }

    public async getTaskCollectionNameIfExists(collectionId: TaskCollectionId): Promise<{
        name: string;
        accessPolicy: AccessPolicy;
        isDeleted: boolean;
    } | null> {
        this._recordDependencyId(`TaskCollection:${collectionId}:Authorization`);
        this._recordDependencyId(`TaskCollection:${collectionId}:Name`);

        const collection = await getTaskCollectionFromIndexIfExists(
            this._context,
            this._context.actor.getSpaceId(),
            collectionId,
        );
        if (!collection) return null;

        return {
            name: collection.getName(),
            accessPolicy: collection.getAccessPolicy(),
            isDeleted: collection.isDeleted(),
        };
    }
}

function mergeMessageItemStreamIntoPayload(messageItem: MessageItem): MessagePayload {
    switch (messageItem.payload.type) {
        case "Deleted":
            return messageItem.payload;
        case "Content": {
            if (!messageItem.stream) return messageItem.payload;

            const nodes: Array<Node> = [];

            if (
                messageItem.payload.content.childCount === 1 &&
                messageItem.payload.content.firstChild!.type.name === "paragraph" &&
                messageItem.payload.content.firstChild!.childCount === 0
            ) {
                // If this is a stream message then ignore empty paragraph content. It'll be
                // replaced with the stream parts.
            } else {
                for (const node of messageItem.payload.content.content.content) {
                    nodes.push(node);
                }
            }

            for (const part of messageItem.stream.parts) {
                if (part.payload.type === "Content") {
                    for (const node of part.payload.content.content.content) {
                        nodes.push(node);
                    }
                }
            }

            // If stream parts didn't add any content then add an empty paragraph.
            if (nodes.length === 0) {
                nodes.push(MessageContentProsemirrorSchema.nodes.paragraph.create());
            }

            return {
                ...messageItem.payload,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.nodes.doc.create({}, nodes),
                ),
            };
        }
        default:
            throw exhaustive(messageItem.payload);
    }
}

function getSearchEntityIndexAccessPolicy(
    accessPolicy: AccessPolicy,
): SearchEntityIndexAccessPolicy {
    const defaultGrantType: SearchEntityIndexDefaultGrantType | null =
        accessPolicy.defaultGrant !== null ? "Space" : null;
    let accountGrantAccountIds = new Set(accessPolicy.accountGrantById.keys());

    // If we have a space default grant then the individual account grants don't matter
    // for the search entity. Lets exclude them to save space in the index.
    if (defaultGrantType !== null) {
        cast<"Space">(defaultGrantType);
        accountGrantAccountIds = new Set();
    }

    return {
        accountGrantAccountIds,
        defaultGrantType,
        urlGrantLevel: accessPolicy.urlGrant?.level ?? null,
    };
}

export function isSearchEntityIndexAccessPolicySubset(
    supersetAccessPolicy: SearchEntityIndexAccessPolicy,
    subsetAccessPolicy: SearchEntityIndexAccessPolicy,
): boolean {
    // If the superset is shared with everyone in the space then it'll include whatever
    // is inside the subset.
    if (supersetAccessPolicy.defaultGrantType === "Space") return true;

    // If the subset is shared with everyone in the space but the superset was NOT
    // shared with everyone in the space then the subset is shared with more people
    // than the superset.
    if (subsetAccessPolicy.defaultGrantType === "Space") return false;

    // Use TypeScript to make sure `defaultGrantType` is `null` by this point.
    cast<null>(supersetAccessPolicy.defaultGrantType);
    cast<null>(subsetAccessPolicy.defaultGrantType);

    // Make sure every subset account is also in the superset. It's fine if the
    // superset has more accounts than the subset but every subset account must be in
    // the superset.
    for (const accountId of subsetAccessPolicy.accountGrantAccountIds) {
        if (!supersetAccessPolicy.accountGrantAccountIds.has(accountId)) {
            return false;
        }
    }

    return true;
}

async function getSearchContentReferences(
    state: SearchEntityReadState,
    originEntityId: SearchEntityId,
    accessPolicy: SearchEntityIndexAccessPolicy,
    content: Node,
    // The `seen` argument is required since it's very risky if you accidentally forget
    // to provide the argument. Specifically when you're calling this function
    // recursively. If there's a cycle and you forget to provide the `seen` set then
    // we'll keep iterating forever and the function never terminates!
    //
    // If you're not calling this function recursively you can pass in `emptySet` which
    // would be the default if this argument were optional.
    seen: ReadonlySet<SearchEntityId>,
): Promise<{
    getAccountIfExists: (accountId: AccountId) => AccountModelWithoutSpaceData | null;
    getSearchEntityIfExists: (
        entityId: SearchMentionEntityId,
    ) => RenderContentMentionToTextSearchEntity | null;
    getFileIfExists: (fileId: FileId) => {readonly contentType: FileContentType} | null;
}> {
    seen = new Set(addToIterable(seen, originEntityId));

    const referencedIds = getContentReferencedIdsForNode(content);

    const [accounts, searchEntityEntries, fileEntries] = await runAllPromises([
        runAllPromises(
            mapIterable(referencedIds.accountIds, accountId => state.getAccountIfExists(accountId)),
        ),
        runAllPromises(
            mapIterable(
                referencedIds.searchEntityIds,
                async (
                    entityId,
                ): Promise<
                    [SearchMentionEntityId, RenderContentMentionToTextSearchEntity] | null
                > => {
                    // If we've already seen this `entityId` then instead of loading it again (which
                    // would cause an infinite loop), break the cycle.
                    if (seen.has(entityId)) {
                        return [
                            entityId,
                            {
                                isPrivate: false,
                                title: "[…]",
                                getAccountMediaShortName: null,
                            },
                        ];
                    }

                    const entity = await getSearchMentionEntityIfExists(state, entityId, seen);
                    if (!entity) return null;

                    const entityAccessPolicy =
                        "defaultGrantType" in entity.accessPolicy
                            ? entity.accessPolicy
                            : getSearchEntityIndexAccessPolicy(entity.accessPolicy);

                    // For the purposes of our search index, we consider an entity to be private if
                    // anyone with access to the entity we're indexing can't view the entity that's
                    // been referenced.
                    //
                    // Let's say we have document 1 that's referencing document 2:
                    //
                    // ```
                    // # Document 1
                    //
                    // Check out @Document 2.
                    // ```
                    //
                    // ```
                    // # Document 2
                    //
                    // Not much going on here.
                    // ```
                    //
                    // Let's say document 1 is shared with Alice and Bob but document 2 is only shared
                    // with Alice. In this case we'll index document 1 as "Check out Private document"
                    // instead of "Check out Document 2". That's because Bob can't view "Document 2" so
                    // we can't put the name "Document 2" in the search index since Bob would be able
                    // to search for "Document 1" and see the name of the private document through
                    // search!
                    //
                    // This behavior is unfortunate for Alice since when she searches for "Document 1"
                    // she'll also see "Check out Private document" in search but then when clicking to
                    // open the document she'll see the name "Document 2" since she has access to
                    // "Document 2".
                    //
                    // We believe this is an acceptable trade-off. Most of the time, if you're
                    // mentioning an entity it'll be shared with everyone else who has access to the
                    // thing you're referencing the entity from. Otherwise some of your coworkers might
                    // complain they don't have access.
                    //
                    // We also want to eventually build a modal when you try referencing something not
                    // everyone has access to which asks whether you want to broaden the permissions of
                    // the entity you're sharing. This modal would make the edge case where you
                    // reference something with fewer permissions than the entity you're referencing
                    // from less common.
                    if (!isSearchEntityIndexAccessPolicySubset(entityAccessPolicy, accessPolicy)) {
                        return [entityId, {isPrivate: true}];
                    }

                    return [
                        entityId,
                        {
                            isPrivate: false,
                            title: entity.title,
                            getAccountMediaShortName: entity.getAccountMediaShortName ?? null,
                        },
                    ];
                },
            ),
        ),
        runAllPromises(
            mapIterable(
                referencedIds.fileIds,
                async (
                    fileId,
                ): Promise<[FileId, {readonly contentType: FileContentType}] | null> => {
                    const contentType = await state.getFileContentTypeIfExists(fileId);
                    if (!contentType) return null;
                    return [fileId, {contentType}];
                },
            ),
        ),
    ]);

    const accountById = new Map<AccountId, AccountModelWithoutSpaceData>(
        filterMapIterable(accounts, account => {
            if (!account) return;
            return [account.id, account];
        }),
    );

    const searchEntityById = new Map<SearchMentionEntityId, RenderContentMentionToTextSearchEntity>(
        searchEntityEntries.filter(isNonNullable),
    );

    const fileById = new Map<FileId, {readonly contentType: FileContentType}>(
        fileEntries.filter(isNonNullable),
    );

    return {
        getAccountIfExists: accountId => accountById.get(accountId) ?? null,
        getSearchEntityIfExists: entityId => searchEntityById.get(entityId) ?? null,
        getFileIfExists: fileId => fileById.get(fileId) ?? null,
    };
}

async function getSearchMentionEntityIfExists(
    state: SearchEntityReadState,
    entityId: SearchMentionEntityId,
    seen: ReadonlySet<SearchEntityId>,
): Promise<{
    accessPolicy: AccessPolicy | SearchEntityIndexAccessPolicy;
    title: string | null;
    getAccountMediaShortName?: (() => string) | null;
} | null> {
    const entityIdObject = parseSearchMentionEntityId(entityId);

    switch (entityIdObject.type) {
        case "Document": {
            const document = await state.getDocumentTitleIfExists(entityIdObject.documentId);
            if (!document) return null;
            return {accessPolicy: document.accessPolicy, title: document.title};
        }
        case "Channel": {
            const channel = await state.getChannelPreviewIfExists(entityIdObject.channelId);
            if (!channel) return null;
            return {accessPolicy: channel.accessPolicy, title: channel.name};
        }
        case "Chat": {
            const chat = await state.getChatDefinitionIfExists(entityIdObject.chatId);
            if (!chat) return null;

            if (chat.type === "Room") {
                return {
                    accessPolicy: chat.accessPolicy,
                    title: chat.name,
                };
            }

            const sortedAccountIds = sortSearchDirectChatEntityAccountIds(
                entityIdObject.chatId,
                chat.accountIds,
            );

            const previewAccounts = await runAllPromises(
                sortedAccountIds
                    .slice(0, searchChatEntityResultTitlePreviewAccountCount)
                    .map(accountId => state.getAccount(accountId)),
            );

            return {
                accessPolicy: {
                    accountGrantAccountIds: new Set(chat.accountIds),
                    defaultGrantType: null,
                    urlGrantLevel: null,
                },
                title: prepareSearchDirectChatEntityTitleForResult("System", {
                    previewAccounts,
                    accountCount: sortedAccountIds.length,
                }),
            };
        }
        case "Task": {
            const task = await state.getTaskTitleIfExists(entityIdObject.taskId);
            if (!task) return null;

            const accessPolicy = getTaskSearchEntityAccessPolicy({
                ...task,
                expectedAccessLevel: "View",
            });

            if (task.task.isDeleted()) return {accessPolicy, title: null};

            const title = addFallbackToTaskTitle(task.title.getText());

            return {accessPolicy, title};
        }
        case "TaskCollection": {
            const collection = await state.getTaskCollectionNameIfExists(
                entityIdObject.collectionId,
            );
            if (!collection) return null;
            if (collection.isDeleted) return {accessPolicy: collection.accessPolicy, title: null};
            return {accessPolicy: collection.accessPolicy, title: collection.name};
        }
        case "Post": {
            const post = await state.getPostContentTitleSnippetAndChannelIfExists(
                entityIdObject.postId,
            );
            if (!post) return null;

            const [author, contentReferences] = await runAllPromises([
                state.getAccount(post.authorId),
                getSearchContentReferences(
                    state,
                    entityId,
                    getSearchEntityIndexAccessPolicy(post.channel.accessPolicy),
                    post.contentTitleSnippet,
                    seen,
                ),
            ]);

            const title = createPostSearchEntityTitleWithAlreadySnippedContent(
                post.channel.name,
                post.contentTitleSnippet,
                contentReferences,
            );

            return {
                accessPolicy: post.channel.accessPolicy,
                title,
                getAccountMediaShortName: () => getAccountShortNameWithoutFullNameTooltip(author),
            };
        }
        default:
            throw exhaustive(entityIdObject);
    }
}

/**
 * Gets a `SearchEntity` object for any searchable thing in our system. This
 * function guarantees read-after-write consistency. If you've waited for a write
 * to commit then this function will read it (this means all DynamoDB reads are
 * made with strong consistency).
 *
 * While reading we may optionally register a function to perform additional write
 * actions. If we call this function as a part of the `IndexSearchEntity` job then
 * the additional writes will be run alongside updating our OpenSearch index.
 */
export async function getSearchEntity(
    context: ServerSystemActionContext,
    idObject: SearchDynamicEntityIdObject,
    options: {
        tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
        registerAdditionalWrite: (
            action: (context: ServerSystemActionContext) => Promise<void>,
        ) => void;
    },
): Promise<{
    dependencyIds: Iterable<SearchEntityDependencyId>;
    entity: SearchEntity;
}> {
    const id = printSearchDynamicEntityId(idObject);

    const state = new SearchEntityReadState(context, id, options);

    const entity = await actuallyGetSearchEntity(state, idObject);

    return {
        dependencyIds: state.getDependencyIds(),
        entity,
    };
}

async function actuallyGetSearchEntity(
    state: SearchEntityReadState,
    idObject: SearchDynamicEntityIdObject,
): Promise<SearchEntity> {
    switch (idObject.type) {
        case "Account":
            return getAccountSearchEntity(state, idObject.accountId);
        case "Document":
            return getDocumentSearchEntity(state, idObject.documentId);
        case "DocumentComment":
            return getDocumentCommentSearchEntity(state, idObject);
        case "Channel":
            return getChannelSearchEntity(state, idObject.channelId);
        case "Post":
            return getPostSearchEntity(state, idObject.postId);
        case "PostComment":
            return getPostCommentSearchEntity(state, idObject);
        case "Chat":
            return getChatSearchEntity(state, idObject.chatId);
        case "ChatMessage":
            return getChatMessageSearchEntity(state, idObject);
        case "Task":
            return getTaskSearchEntity(state, idObject.taskId);
        case "TaskCollection":
            return getTaskCollectionSearchEntity(state, idObject.collectionId);
        case "TaskComment":
            return getTaskCommentSearchEntity(state, idObject);
        default:
            throw exhaustive(idObject);
    }
}

async function getAccountSearchEntity(
    state: SearchEntityReadState,
    accountId: AccountId,
): Promise<SearchEntity> {
    const account = await state.getAccountWithSpace(accountId);

    return {
        id: `Account:${accountId}`,

        // Anyone in a space can see all the accounts in a space.
        accessPolicy: {
            accountGrantAccountIds: emptySet,
            defaultGrantType: "Space",
            urlGrantLevel: null,
        },

        createdTime: account.initialData.space.addedTime,

        title: account.initialData.name,
        titleVersion: {type: "Integer", version: account.initialData.nameVersion},
        body: null,
        tags: emptyArray,
        media: {type: "Account", accountId},
        embeddingChunks: emptyArray,

        // Doesn't make sense that an account would create itself. So mark an account has
        // having no creator.
        creatorId: null,
        contributorIds: emptyMap,
        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}

export const getDocumentSearchEntityTestCheckpoint = new TestCheckpoint<DocumentId>();

async function getDocumentSearchEntity(
    state: SearchEntityReadState,
    documentId: DocumentId,
): Promise<SearchEntity> {
    const entityId: SearchEntityId = `Document:${documentId}`;

    const {
        createdTime,
        version,
        content,
        creator,
        stepCountByNonCreatorAccountId,
        updateContentPreview,
    } = await state.getDocumentContent(documentId);

    // If we're running an `IndexSearchEntity` job then we also want to update the
    // document's content preview alongside updating the OpenSearch index.
    state.registerAdditionalWrite(updateContentPreview);

    await getDocumentSearchEntityTestCheckpoint.waitForTest(documentId);

    const accessPolicy = getSearchEntityIndexAccessPolicy(content.attrs.accessPolicy);

    const contentReferences = await getSearchContentReferences(
        state,
        entityId,
        accessPolicy,
        content,
        emptySet,
    );

    const {title, getFullText, getEmbeddingChunks} = chunkDocumentSearchContent(content, {
        tokenizer: state.tokenizer,
        getAccountIfExists: contentReferences.getAccountIfExists,
        getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
    });

    const contributorIds = new Map<AccountId, "Major" | "Minor">();
    let stepCountByNonCreatorAccounts = 0;

    for (const [nonCreatorAccountId, stepCount] of stepCountByNonCreatorAccountId.get()) {
        stepCountByNonCreatorAccounts += stepCount;

        contributorIds.set(
            nonCreatorAccountId,
            stepCount / version >= searchEntityMajorContributorCutOff ? "Major" : "Minor",
        );
    }

    if (creator.id !== null) {
        const contributorType =
            (version - stepCountByNonCreatorAccounts) / version > searchEntityMajorContributorCutOff
                ? "Major"
                : "Minor";

        contributorIds.set(creator.id, contributorType);

        if (creator.from?.type === "Bot" && creator.from.accountId !== creator.id) {
            contributorIds.set(creator.from.accountId, contributorType);
        }
    }

    return {
        id: entityId,
        accessPolicy,
        createdTime,
        title,
        titleVersion: {type: "Integer", version},
        body: getFullText(),
        tags: emptyArray,
        media: null,
        embeddingChunks: getEmbeddingChunks(),
        creatorId: creator.id,
        contributorIds,
        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}

export function chunkDocumentSearchContent(
    content: DocumentContent,
    {
        tokenizer,
        getAccountIfExists,
        getSearchEntityIfExists,
    }: {
        tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
        getAccountIfExists: (accountId: AccountId) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
) {
    const title = getDocumentContentTitle(content);

    const truncatedTitle = new Lazy(() =>
        truncateTokens(tokenizer, title, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(tokenizer, sectionHeading, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    assert(content.firstChild?.type.name === "title");

    // Create a copy of the document without its title. We add the title back in the
    // chunk preamble of the first chunk.
    const contentWithoutTitle = content.type.create(
        content.attrs,
        content.content.content.slice(1),
    );

    const {getFullText, getEmbeddingChunks} = chunkSearchContent(contentWithoutTitle, {
        tokenizer,
        getAccountIfExists,
        getSearchEntityIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            if (isInitialChunk) return {text: `# ${title}`, lineMarginBottom: 2};

            return {
                text: `This is from the \u201C${truncatedTitle.get()}\u201D document${
                    context.sectionHeading !== null
                        ? ` in the \u201C${truncatedSectionHeading.get(context.sectionHeading)}\u201D section`
                        : ""
                }:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {title, getFullText, getEmbeddingChunks};
}

async function getDocumentCommentSearchEntity(
    state: SearchEntityReadState,
    {
        documentId,
        commentThreadId,
        commentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
    },
): Promise<SearchEntity> {
    const id: SearchEntityId = `DocumentComment:${documentId}-${commentThreadId}-${commentIndex}`;

    const {
        createdTime,
        authorId,
        payload: commentPayload,
        stream: commentStream,
        documentAccessPolicy,
    } = await state.getDocumentCommentPayload(documentId, commentThreadId, commentIndex);

    // If we're running an `IndexSearchEntity` job then we also want to check if the
    // message has timed out alongside updating the OpenSearch index.
    if (commentStream) {
        state.registerAdditionalWrite(
            createMessageStreamTimeoutAdditionalWrite(
                {documentId, commentThreadId, commentIndex},
                commentStream,
                putDocumentCommentStreamPart,
            ),
        );
    }

    if (commentPayload.type === "Deleted") {
        return {...searchDeletedMessageEntity, id};
    }

    const accessPolicy = getSearchEntityIndexAccessPolicy(documentAccessPolicy);

    const contentReferences = await getSearchContentReferences(
        state,
        id,
        accessPolicy,
        commentPayload.content,
        emptySet,
    );

    const content = chunkSearchContent(commentPayload.content, {
        tokenizer: state.tokenizer,
        getAccountIfExists: contentReferences.getAccountIfExists,
        getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
        getChunkPreamble: ({isInitialChunk}) => {
            return {
                text: `This is${isInitialChunk ? " a " : " from a "}comment on a document:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id,
        accessPolicy,
        createdTime,
        title: null,
        titleVersion: null,
        body: content?.getFullText() ?? null,
        tags: emptyArray,
        media: {type: "Account", accountId: authorId},
        embeddingChunks: content?.getEmbeddingChunks() ?? [],
        creatorId: authorId,
        contributorIds: emptyMap,
        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}

async function getChannelSearchEntity(
    state: SearchEntityReadState,
    channelId: ChannelId,
): Promise<SearchEntity> {
    const id: SearchEntityId = `Channel:${channelId}`;

    const channel = await state.getChannelNameAndDescriptionContentAndContributors(channelId);

    const accessPolicy = getSearchEntityIndexAccessPolicy(channel.accessPolicy);

    const truncatedName = new Lazy(() =>
        truncateTokens(state.tokenizer, channel.name, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(
            state.tokenizer,
            sectionHeading,
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const contentReferences = await getSearchContentReferences(
        state,
        id,
        accessPolicy,
        channel.description,
        emptySet,
    );

    const {getFullText, getEmbeddingChunks} = chunkSearchContent(channel.description, {
        tokenizer: state.tokenizer,
        getAccountIfExists: contentReferences.getAccountIfExists,
        getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
        getChunkPreamble: ({isInitialChunk, context}) => {
            if (isInitialChunk) {
                return {
                    text:
                        `# ${truncatedName.get()}` +
                        // If there's no channel description, add a default description letting the
                        // embedder know more about what kind of thing this is.
                        (isContentEmpty(channel.description) ? "\n\nThis is a channel." : ""),
                    lineMarginBottom: 2,
                };
            }

            return {
                text: `This is from the \u201C${truncatedName.get()}\u201D channel description${
                    context.sectionHeading !== null
                        ? ` in the \u201C${truncatedSectionHeading.get(context.sectionHeading)}\u201D section`
                        : ""
                }:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id,
        accessPolicy,
        createdTime: channel.createdTime,
        title: channel.name,
        titleVersion: {type: "Integer", version: channel.version},
        body: getFullText(),
        tags: emptyArray,
        media: null,
        embeddingChunks: getEmbeddingChunks(),
        creatorId: channel.creatorId,
        // Contributors at the max contribution count (as of 2025-04-30 that's 8) are
        // considered major contributors.
        contributorIds: new Map(
            concatIterables(
                mapIterable(
                    channel.contributionCountByAccountId,
                    ([accountId, contributionCount]): [AccountId, "Major" | "Minor"] => [
                        accountId,
                        contributionCount >= maxChannelContributionCount ? "Major" : "Minor",
                    ],
                ),
                channel.creatorId !== null ? [[channel.creatorId, "Major"]] : emptyArray,
            ),
        ),
        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}

async function getPostSearchEntity(
    state: SearchEntityReadState,
    postId: PostId,
): Promise<SearchEntity> {
    const id: SearchEntityId = `Post:${postId}`;

    const post = await state.getPostContentAndChannel(postId);

    const truncatedChannelName = new Lazy(() =>
        truncateTokens(
            state.tokenizer,
            post.channel.name,
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(
            state.tokenizer,
            sectionHeading,
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const accessPolicy = getSearchEntityIndexAccessPolicy(post.channel.accessPolicy);

    const contentReferences = await getSearchContentReferences(
        state,
        id,
        accessPolicy,
        post.content,
        emptySet,
    );

    const {getFullText, getEmbeddingChunks} = chunkSearchContent(post.content, {
        tokenizer: state.tokenizer,
        getAccountIfExists: contentReferences.getAccountIfExists,
        getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            return {
                text: `This is${isInitialChunk ? " a " : " from a "}post${
                    context.sectionHeading !== null
                        ? ` in the \u201C${truncatedSectionHeading.get(
                              context.sectionHeading,
                          )}\u201D section `
                        : " "
                }in the \u201C${truncatedChannelName.get()}\u201D channel:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id,
        accessPolicy,
        createdTime: post.createdTime,
        title: createPostSearchEntityTitle(post.channel.name, post.content, {
            getAccountIfExists: contentReferences.getAccountIfExists,
            getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
            getFileIfExists: contentReferences.getFileIfExists,
        }),
        titleVersion: {type: "Integers", versions: [post.version, post.channel.version]},
        body: `in ${post.channel.name}: ${getFullText()}`,
        tags: emptyArray,
        media: {type: "Account", accountId: post.authorId},
        embeddingChunks: getEmbeddingChunks(),
        creatorId: post.authorId,
        contributorIds: emptyMap,
        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}

async function getPostCommentSearchEntity(
    state: SearchEntityReadState,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<SearchEntity> {
    const id: SearchEntityId = `PostComment:${postId}-${commentIndex}`;

    const {
        createdTime,
        authorId,
        payload: commentPayload,
        stream: commentStream,
        channelAccessPolicy,
    } = await state.getPostCommentPayload(postId, commentIndex);

    // If we're running an `IndexSearchEntity` job then we also want to check if the
    // message has timed out alongside updating the OpenSearch index.
    if (commentStream) {
        state.registerAdditionalWrite(
            createMessageStreamTimeoutAdditionalWrite(
                {postId, commentIndex},
                commentStream,
                putPostCommentStreamPart,
            ),
        );
    }

    if (commentPayload.type === "Deleted") {
        return {...searchDeletedMessageEntity, id};
    }

    const accessPolicy = getSearchEntityIndexAccessPolicy(channelAccessPolicy);

    const contentReferences = await getSearchContentReferences(
        state,
        id,
        accessPolicy,
        commentPayload.content,
        emptySet,
    );

    const content = chunkSearchContent(commentPayload.content, {
        tokenizer: state.tokenizer,
        getAccountIfExists: contentReferences.getAccountIfExists,
        getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
        getChunkPreamble: ({isInitialChunk}) => {
            return {
                text: `This is${isInitialChunk ? " a " : " from a "}comment on a post:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id,
        accessPolicy,
        createdTime,
        title: null,
        titleVersion: null,
        body: content?.getFullText() ?? null,
        tags: emptyArray,
        media: {type: "Account", accountId: authorId},
        embeddingChunks: content?.getEmbeddingChunks() ?? [],
        creatorId: authorId,
        contributorIds: emptyMap,
        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}

export function sortSearchDirectChatEntityAccountIds(
    chatId: ChatId,
    originalAccountIds: Iterable<AccountId>,
) {
    // Randomize the account order based on the `ChatId`. That way we should randomly
    // select which accounts to show in the account pile.
    const accountIds = Array.from(originalAccountIds);
    accountIds.sort(defaultCompareStrings);

    const stableRandom = new StableRandom(`Chat:${chatId}`);
    stableShuffleArray(stableRandom, "accountIds", accountIds);

    return accountIds;
}

/**
 * For chat room media we use an `AccountPile` and pick 2 accounts at random. We
 * try to use major contributors for those 2 accounts but if there are minor
 * contributros too we'll include them.
 */
export function getSearchRoomChatEntityMedia(
    chatId: ChatId,
    chatCreatorId: AccountId,
    contributorIds: ReadonlyMap<AccountId, "Major" | "Minor">,
): SearchEntityMedia {
    const previewAccountIds = getRoomChatPreviewAccountIds(chatId, chatCreatorId, contributorIds);

    if (previewAccountIds.length === 1) {
        return {type: "Account", accountId: previewAccountIds[0]};
    } else {
        return {
            type: "AccountPile",
            previewAccountIds: previewAccountIds,
            accountCount: null,
        };
    }
}

async function getChatSearchEntity(
    state: SearchEntityReadState,
    chatId: ChatId,
): Promise<SearchEntity> {
    const {version, createdTime, definition, messagesSummary} =
        await state.getChatDefinitionAndMessagesSummary(chatId);

    if (
        // If the chat has no messages yet, don't index any content. This means the chat
        // won't show up in search. We don't show the chat in search until it gets its
        // first message.
        (definition.type === "Direct" && !hasChatMessages(messagesSummary)) ||
        // If a chat only has two accounts, don't index the chat. Instead you should access
        // a 1:1 chat with another account by searching for their account entity (indexed
        // by `getAccountSearchEntity()`).
        //
        // Otherwise when you search for an account's name you'll see both your 1:1 chat
        // with them and their account which is a little weird.
        //
        // Also don't index the chat if it only has one account (so it's a private,
        // personal, chat). Again if you search for your account name it'll show you the
        // chat.
        (definition.type === "Direct" && definition.accountIds.size <= 2)
    ) {
        return {
            id: `Chat:${chatId}`,
            accessPolicy: {
                accountGrantAccountIds: emptySet,
                defaultGrantType: null,
                urlGrantLevel: null,
            },
            createdTime,
            title: null,
            titleVersion: null,
            body: null,
            tags: emptyArray,
            media: null,
            embeddingChunks: emptyArray,
            creatorId: null,
            contributorIds: emptyMap,
            dueDate: null,
            assigneeId: null,
            priority: null,
            openness: null,
            activeness: null,
        };
    }

    let title: string;
    let contributorIds: ReadonlyMap<AccountId, "Major" | "Minor">;
    let media: SearchEntityMedia | null;

    if (definition.type === "Room") {
        title = definition.name;
        contributorIds = getChatSearchEntityContributorIds(definition, messagesSummary);
        media = getSearchRoomChatEntityMedia(chatId, definition.creatorId, contributorIds);
    } else {
        const accounts = await runAllPromises(
            mapIterable(definition.accountIds, accountId => state.getAccount(accountId)),
        );

        // We index an alphabetically ordered list of full account names. So that we can
        // keyword match based on full names when searching. However, it's a mouthful so
        // when we render a chat we use a simpler format of two short names and "${n}
        // others".
        title = joinPrettyConjunctionList(
            accounts
                .map(account => account.name)
                .sort((name1, name2) => name1.localeCompare(name2, defaultLocale)),
            "and",
        );

        // Consider all members of the chat to be major contributors! Since the number of
        // people in the chat will generally be small.
        //
        // It's a little odd that only multi-user chats get this designation. If you search
        // for "chats I'm a contributor to" (aka "my chats") you'd expect to see 1:1 chats
        // there too but currently we don't index 1:1 chats. We only index accounts.
        contributorIds = new Map(
            mapIterable(definition.accountIds, accountId => [accountId, "Major"]),
        );

        media =
            definition.accountIds.size === 1
                ? {type: "Account", accountId: assertExists(iterableFirst(definition.accountIds))}
                : {
                      type: "AccountPile",
                      previewAccountIds: sortSearchDirectChatEntityAccountIds(
                          chatId,
                          definition.accountIds,
                      ).slice(
                          0,
                          // Add 1 to make sure we can filter out the actor account and still have enough
                          // accounts to render a nice looking pile.
                          searchChatEntityResultTitlePreviewAccountCount + 1,
                      ),
                      accountCount: definition.accountIds.size,
                  };
    }

    return {
        id: `Chat:${chatId}`,

        accessPolicy:
            definition.type === "Room"
                ? getSearchEntityIndexAccessPolicy(definition.accessPolicy)
                : {
                      accountGrantAccountIds: new Set(definition.accountIds),
                      defaultGrantType: null,
                      urlGrantLevel: null,
                  },

        createdTime,
        title,
        // TODO: There's a title for direct chats, should we have a title version? We don't
        // care too much about a title version here since clients don't need to update
        // account names in realtime.
        titleVersion: definition.type === "Room" ? {type: "Integer", version} : null,
        body: null,
        // Used to search for exclusively chat rooms. Also useful in keyword search since
        // queries like "Engineering chat room" will now match "room".
        tags: definition.type === "Room" ? ["room"] : emptyArray,
        media,
        embeddingChunks: emptyArray,
        creatorId: definition.type === "Room" ? definition.creatorId : null,
        contributorIds,

        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}

const nameByNumber = new Map([
    [1, "one"],
    [2, "two"],
    [3, "three"],
    [4, "four"],
    [5, "five"],
    [6, "six"],
    [7, "seven"],
    [8, "eight"],
    [9, "nine"],
    [10, "ten"],
]);

function createMessageStreamTimeoutAdditionalWrite<Options extends {}>(
    options: Options,
    messageStream: MessageStream & {readonly lastPingTime: Date | null},
    putMessageStreamPart: (
        context: ServerSystemActionContext,
        options: Options & {
            partIndex: "Create";
            payload: MessageStreamPartPayload;
            isTimeoutErrorCompletion: true;
        },
    ) => Promise<unknown>,
) {
    return async (context: ServerSystemActionContext) => {
        // Message stream has been successfully completed! No update needed.
        if (messageStream.completedTime !== null) return;

        const currentTime = new Date();

        // If we've possibly passed the stream timeout then complete the stream with a
        // final error message.
        //
        // We need to account for clock skew because message stream code schedules the
        // `IndexSearchEntity` job to always run after possible stream timeout. If the
        // message has timed out we have to complete it here or else the message will be in
        // an incomplete state on the client forever!
        if (
            !isDatePossiblyLessThanWithUncertaintyWindow(
                (messageStream.lastPingTime ?? messageStream.createdTime).getTime() +
                    messageStreamTimeoutMs,
                currentTime,
            )
        ) {
            return;
        }

        const content = assertMessageContent(
            fromApiContent(
                MessageContentProsemirrorSchema,
                parseApiContentFromMarkdown(defaultAgentErrorDisplayMessage, {
                    spaceId: context.actor.getSpaceId(),
                }),
            ),
        );

        await putMessageStreamPart(context, {
            ...options,
            partIndex: "Create",
            payload: {type: "Content", content},
            // We're putting an error part after the message has timed out. We need to skip the
            // time out check or this will throw an error.
            //
            // This will also complete the stream.
            isTimeoutErrorCompletion: true,
        });
    };
}

async function getChatMessageSearchEntity(
    state: SearchEntityReadState,
    {chatId, messageIndex}: {chatId: ChatId; messageIndex: number},
): Promise<SearchEntity> {
    const id: SearchEntityId = `ChatMessage:${chatId}-${messageIndex}`;

    const [
        chatDefinition,
        {createdTime, authorId, payload: messagePayload, stream: messageStream},
    ] = await runAllPromises([
        state.getChatDefinition(chatId),
        state.getChatMessagePayload(chatId, messageIndex),
    ]);

    // If we're running an `IndexSearchEntity` job then we also want to check if the
    // message has timed out alongside updating the OpenSearch index.
    if (messageStream) {
        state.registerAdditionalWrite(
            createMessageStreamTimeoutAdditionalWrite(
                {chatId, messageIndex},
                messageStream,
                putChatMessageStreamPart,
            ),
        );
    }

    if (messagePayload.type === "Deleted") {
        return {...searchDeletedMessageEntity, id};
    }

    const accessPolicy: SearchEntityIndexAccessPolicy =
        chatDefinition.type === "Room"
            ? getSearchEntityIndexAccessPolicy(chatDefinition.accessPolicy)
            : {
                  accountGrantAccountIds: new Set(chatDefinition.accountIds),
                  defaultGrantType: null,
                  urlGrantLevel: null,
              };

    const contentReferences = await getSearchContentReferences(
        state,
        id,
        accessPolicy,
        messagePayload.content,
        emptySet,
    );

    const truncatedRoomChatName = new Lazy(() =>
        truncateTokens(
            state.tokenizer,
            chatDefinition.type === "Room" ? chatDefinition.name : "",
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const content = chunkSearchContent(messagePayload.content, {
        tokenizer: state.tokenizer,
        getAccountIfExists: contentReferences.getAccountIfExists,
        getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
        getChunkPreamble: ({isInitialChunk}) => {
            return {
                text: `This is${isInitialChunk ? " a " : " from a "}message in ${
                    chatDefinition.type === "Room"
                        ? `the \u201C${truncatedRoomChatName.get()}\u201D chat`
                        : chatDefinition.accountIds.size > 1
                          ? `a chat between ${
                                nameByNumber.get(chatDefinition.accountIds.size) ??
                                chatDefinition.accountIds.size
                            } people`
                          : ""
                }:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id,
        accessPolicy,
        createdTime,
        title: null,
        titleVersion: null,
        body: content?.getFullText() ?? null,
        tags: emptyArray,
        media: {type: "Account", accountId: authorId},
        embeddingChunks: content?.getEmbeddingChunks() ?? [],
        creatorId: authorId,
        contributorIds: emptyMap,
        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}

function getTaskSearchEntityAccessPolicy({
    task,
    referencedTaskById,
    referencedCollectionById,
    expectedAccessLevel,
}: {
    task: TaskModelForAuthorization;
    referencedTaskById: ReadonlyMap<TaskId, TaskModelForAuthorization>;
    referencedCollectionById: ReadonlyMap<TaskCollectionId, TaskCollectionModelForAuthorization>;
    expectedAccessLevel: AccessLevel;
}): SearchEntityIndexAccessPolicy {
    let defaultGrantType: SearchEntityIndexDefaultGrantType | null = null;
    const accountGrantAccountIds = new Set<AccountId>();

    const trackAccessPolicy = (accessPolicy: AccessPolicy) => {
        if (
            accessPolicy.defaultGrant !== null &&
            hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)
        ) {
            if (defaultGrantType === null) {
                defaultGrantType = "Space";
            } else {
                assert(defaultGrantType === "Space");
            }
        }

        for (const [accountId, grant] of accessPolicy.accountGrantById) {
            if (hasAccessLevel(grant.level, expectedAccessLevel)) {
                accountGrantAccountIds.add(accountId);
            }
        }
    };

    const trackTaskDependencies = (task: TaskModelForAuthorization) => {
        trackAccessPolicy(task.getAccessPolicy());

        const assignee = task.getAssignee();
        if (assignee && hasAccessLevel("Edit", expectedAccessLevel)) {
            accountGrantAccountIds.add(assignee.assignee.accountId);
        }

        for (const {collectionId} of task.getCollections().getArray()) {
            // Assert is safe since all referenced collections should have loaded.
            const collection = assertExists(referencedCollectionById.get(collectionId));

            // Deleted collections don't contribute to the access policy...
            if (collection.isDeleted()) continue;

            const accessPolicy = collection.getAccessPolicy();
            trackAccessPolicy(accessPolicy);
        }

        const parentTaskId = task.getParent()?.taskId;
        if (parentTaskId) {
            // Assert is safe since all referenced tasks should have loaded.
            const parentTask = assertExists(referencedTaskById.get(parentTaskId));

            // If the parent task is not deleted then our task inherits its access policy.
            if (!parentTask.isDeleted()) {
                trackTaskDependencies(parentTask);
            }
        }
    };

    trackTaskDependencies(task);

    // If we have a space default grant then the individual account grants don't matter
    // for the search entity. Lets exclude them to save space in the index.
    if (defaultGrantType !== null) {
        cast<"Space">(defaultGrantType);
        accountGrantAccountIds.clear();
    }

    return {
        accountGrantAccountIds,
        defaultGrantType,
        urlGrantLevel: null,
    };
}

async function getTaskSearchEntity(
    state: SearchEntityReadState,
    taskId: TaskId,
): Promise<SearchEntity> {
    const id: SearchEntityId = `Task:${taskId}`;

    const taskResult = await state.getTask(taskId);

    const {task, referencedTaskById, referencedCollectionById} = taskResult;

    const accessPolicy = getTaskSearchEntityAccessPolicy({
        task,
        referencedTaskById,
        referencedCollectionById,
        expectedAccessLevel: "View",
    });

    const {title, titleVersion, media} = getTaskSearchEntityBase(task);

    // Index no content for deleted tasks.
    if (taskResult.isDeleted) {
        return {
            id,
            accessPolicy,
            createdTime: new Date(task.getCreatedTime().absoluteTime[0]),
            title,
            titleVersion,
            body: null,
            tags: emptyArray,
            media: null,
            embeddingChunks: emptyArray,
            creatorId: null,
            contributorIds: emptyMap,
            dueDate: null,
            assigneeId: null,
            priority: null,
            openness: null,
            activeness: null,
        };
    }

    const {
        approximateActionCountByAccountId: approximateActionCountByAccountIdWithoutNotesStepCount,
        notesContent,
    } = taskResult;

    const truncatedTitle = new Lazy(() =>
        truncateTokens(
            state.tokenizer,
            // Should only be null when task is deleted.
            assertExists(title),
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(
            state.tokenizer,
            sectionHeading,
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const contentReferences = await getSearchContentReferences(
        state,
        id,
        accessPolicy,
        notesContent.content,
        emptySet,
    );

    const notesChunkResult = chunkSearchContent(notesContent.content, {
        tokenizer: state.tokenizer,
        getAccountIfExists: contentReferences.getAccountIfExists,
        getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            if (isInitialChunk) return {text: `# ${title}`, lineMarginBottom: 2};

            return {
                text: `This is from the \u201C${truncatedTitle.get()}\u201D task${
                    context.sectionHeading !== null
                        ? ` in the \u201C${truncatedSectionHeading.get(context.sectionHeading)}\u201D section`
                        : ""
                }:`,
                lineMarginBottom: 2,
            };
        },
    });

    // Calculate task contributors. For tasks we have discrete updates (update
    // assignee, update priority) and continuous updates (update title, update notes).
    // If an account has >20% contributions in either the discrete or continuous
    // category then we consider it a major contributor.
    let contributorIds: Map<AccountId, "Major" | "Minor">;
    {
        const approximateActionCountByAccountId = new Map<
            AccountId,
            {continuousActionCount: number; discreteActionCount: number}
        >();

        let totalApproximateContinuousActionCount = 0;
        let totalApproximateDiscreteActionCount = 0;
        let notesStepCountByNonCreatorAccounts = 0;

        for (const [
            accountId,
            {continuousActionCount, discreteActionCount},
        ] of approximateActionCountByAccountIdWithoutNotesStepCount.get()) {
            totalApproximateContinuousActionCount += continuousActionCount;
            totalApproximateDiscreteActionCount += discreteActionCount;

            approximateActionCountByAccountId.set(accountId, {
                continuousActionCount,
                discreteActionCount,
            });
        }

        // Add notes step contribution as continuous actions.
        for (const [
            nonCreatorAccountId,
            stepCount,
        ] of notesContent.stepCountByNonCreatorAccountId.get()) {
            notesStepCountByNonCreatorAccounts += stepCount;
            totalApproximateContinuousActionCount += stepCount;

            getOrSetDefaultMapValue(approximateActionCountByAccountId, nonCreatorAccountId, () => ({
                continuousActionCount: 0,
                discreteActionCount: 0,
            })).continuousActionCount += stepCount;
        }

        // Add notes step contribution from the creator as continuous actions since the
        // creator is not in `stepCountByNonCreatorAccountId`.
        {
            const creatorNotesStepCount = notesContent.version - notesStepCountByNonCreatorAccounts;
            totalApproximateContinuousActionCount += creatorNotesStepCount;

            getOrSetDefaultMapValue(
                approximateActionCountByAccountId,
                task.getCreator().accountId,
                () => ({
                    continuousActionCount: 0,
                    discreteActionCount: 0,
                }),
            ).continuousActionCount += creatorNotesStepCount;
        }

        contributorIds = new Map(
            mapIterable(
                approximateActionCountByAccountId,
                ([accountId, {continuousActionCount, discreteActionCount}]) => [
                    accountId,
                    // If the account is either above the cutoff for continuous actions or discrete
                    // actions then we consider it to be a major contributor. It's not really fair to
                    // compare major and discrete actions.
                    continuousActionCount / totalApproximateContinuousActionCount >=
                        searchEntityMajorContributorCutOff ||
                    discreteActionCount / totalApproximateDiscreteActionCount >=
                        searchEntityMajorContributorCutOff
                        ? "Major"
                        : "Minor",
                ],
            ),
        );
    }

    const body = notesChunkResult.getFullText();
    const dueDate = task.getDueDate();

    // Build tags array from non-deleted collection names.
    const tags: Array<string> = [];
    for (const {collectionId} of task.getCollections().getArray()) {
        const collection = referencedCollectionById.get(collectionId);
        if (collection && !collection.isDeleted()) {
            const name = collection.getNameAndRecordDependency();
            tags.push(name);
        }
    }

    return {
        id,
        accessPolicy,
        createdTime: new Date(task.getCreatedTime().absoluteTime[0]),
        title,
        titleVersion,
        body: body.length > 0 ? body : null,
        tags,
        media,
        embeddingChunks: body.length > 0 ? notesChunkResult.getEmbeddingChunks() : emptyArray,
        creatorId: task.getCreator().accountId,
        contributorIds,
        dueDate: dueDate ?? null,
        assigneeId: task.getAssignee()?.assignee.accountId ?? null,
        priority: task.getPriority(),
        openness: task.getStatus().type === "Open" ? "Open" : "Closed",
        activeness: task.getAssigneeStatus().type === "Active" ? "Active" : "Inactive",
    };
}

async function getTaskCollectionSearchEntity(
    state: SearchEntityReadState,
    collectionId: TaskCollectionId,
): Promise<SearchEntity> {
    const id: SearchEntityId = `TaskCollection:${collectionId}`;

    const collection = await state.getTaskCollection(collectionId);

    const accessPolicy = getSearchEntityIndexAccessPolicy(collection.getAccessPolicy());

    const {title, titleVersion, media} = getTaskCollectionSearchEntityBase(collection);

    // Index no content for deleted collections.
    if (collection.isDeleted()) {
        return {
            id: `TaskCollection:${collectionId}`,
            accessPolicy,
            createdTime: new Date(collection.getCreatedTime()[0]),
            title,
            titleVersion,
            body: null,
            tags: emptyArray,
            media: null,
            embeddingChunks: emptyArray,
            creatorId: null,
            contributorIds: emptyMap,
            dueDate: null,
            assigneeId: null,
            priority: null,
            openness: null,
            activeness: null,
        };
    }

    const truncatedName = new Lazy(() =>
        truncateTokens(
            state.tokenizer,
            collection.getName(),
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(
            state.tokenizer,
            sectionHeading,
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const collectionDescription = emptyMessageContent;

    const contentReferences = await getSearchContentReferences(
        state,
        id,
        accessPolicy,
        collectionDescription,
        emptySet,
    );

    // While task collections have no descriptions, we still want to generate embedding
    // chunks. So if you search for "bug task collection" it'll match keyword, NLP, and
    // semantic search to put the bugs task collection at the top.
    const {getEmbeddingChunks} = chunkSearchContent(collectionDescription, {
        tokenizer: state.tokenizer,
        getAccountIfExists: contentReferences.getAccountIfExists,
        getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
        getChunkPreamble: ({isInitialChunk, context}) => {
            if (isInitialChunk) {
                return {
                    text:
                        `# ${truncatedName.get()}` +
                        // If there's no collection description, add a default description letting the
                        // embedder know more about what kind of thing this is.
                        (isContentEmpty(collectionDescription)
                            ? "\n\nThis is a task collection."
                            : ""),
                    lineMarginBottom: 2,
                };
            }

            return {
                text: `This is from the \u201C${truncatedName.get()}\u201D task collection description${
                    context.sectionHeading !== null
                        ? ` in the \u201C${truncatedSectionHeading.get(context.sectionHeading)}\u201D section`
                        : ""
                }:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id,
        accessPolicy,
        createdTime: new Date(collection.getCreatedTime()[0]),
        title,
        titleVersion,
        body: null,
        tags: emptyArray,
        media,
        embeddingChunks: getEmbeddingChunks(),
        creatorId: collection.rawData.creatorId,
        // In the future we could keep track of which accounts were adding tasks to the
        // collection to answer queries like "collections I've added tasks to".
        contributorIds: emptyMap,
        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}

async function getTaskCommentSearchEntity(
    state: SearchEntityReadState,
    {taskId, commentIndex}: {taskId: TaskId; commentIndex: number},
): Promise<SearchEntity> {
    const id: SearchEntityId = `TaskComment:${taskId}-${commentIndex}`;

    const [{task, getReferencedTaskById, getReferencedCollectionById}, commentResult] =
        await runAllPromises([
            state.getTaskForAuthorization(taskId),

            // Will throw a `NotFoundError` if the task was deleted. So ignore the error here
            // if the task was deleted.
            captureResultPromise(state.getTaskCommentPayload(taskId, commentIndex)),
        ]);

    if (task.isDeleted()) {
        return {...searchDeletedMessageEntity, id};
    }

    const {
        createdTime,
        authorId,
        payload: commentPayload,
        stream: commentStream,
    } = unwrapResult(commentResult);

    // If we're running an `IndexSearchEntity` job then we also want to check if the
    // message has timed out alongside updating the OpenSearch index.
    if (commentStream) {
        state.registerAdditionalWrite(
            createMessageStreamTimeoutAdditionalWrite(
                {taskId, commentIndex},
                commentStream,
                putTaskCommentStreamPart,
            ),
        );
    }

    const accessPolicy = getTaskSearchEntityAccessPolicy({
        task,
        referencedTaskById: getReferencedTaskById(),
        referencedCollectionById: getReferencedCollectionById(),
        expectedAccessLevel: "Comment",
    });

    if (commentPayload.type === "Deleted") {
        return {...searchDeletedMessageEntity, id};
    }

    const contentReferences = await getSearchContentReferences(
        state,
        id,
        accessPolicy,
        commentPayload.content,
        emptySet,
    );

    const content = chunkSearchContent(commentPayload.content, {
        tokenizer: state.tokenizer,
        getAccountIfExists: contentReferences.getAccountIfExists,
        getSearchEntityIfExists: contentReferences.getSearchEntityIfExists,
        getChunkPreamble: ({isInitialChunk}) => {
            return {
                text: `This is${isInitialChunk ? " a " : " from a "}comment on a task:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id,
        accessPolicy,
        createdTime,
        title: null,
        titleVersion: null,
        body: content?.getFullText() ?? null,
        tags: emptyArray,
        media: {type: "Account", accountId: authorId},
        embeddingChunks: content?.getEmbeddingChunks() ?? [],
        creatorId: authorId,
        contributorIds: emptyMap,
        dueDate: null,
        assigneeId: null,
        priority: null,
        openness: null,
        activeness: null,
    };
}
