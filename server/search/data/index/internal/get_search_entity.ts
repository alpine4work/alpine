import {getChatAccountIds, getChatMessagePayload} from "~/server/chat/data/chat_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    DocumentStepCountByAccountId,
    getDocumentCommentPayload,
    getDocumentContent,
    getDocumentTitle,
} from "~/server/documents/data/documents_table.js";
import {
    getChannelNameAndDescriptionContentAndContributors,
    getPostCommentPayload,
    getPostContentAndChannelPreview,
    maxChannelContributionCount,
} from "~/server/forum/data/forum_table.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {
    SearchEntityDependencyId,
    isSearchEntityDependencyIdAlsoEntityId,
    isSearchEntityIdAlsoEntityDependencyId,
} from "~/server/search/core/search_entity_dependency_id.js";
import {chunkSearchContent} from "~/server/search/data/index/internal/chunk_search_content.js";
import {
    SearchEntityIndexAccessPolicy,
    SearchEntityIndexDefaultGrantType,
} from "~/server/search/data/index/internal/search_entity_index_doc.js";
import {SearchEntityMedia} from "~/server/search/data/index/internal/search_entity_media.js";
import {truncateTokens} from "~/server/search/data/index/internal/truncate_tokens.js";
import {SearchSystemActionContext} from "~/server/search/data/index/search_action_context.js";
import {getAccount, getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {getTaskCollectionFromIndex, getTaskFromIndex} from "~/server/tasks/data/task_index.js";
import {TaskApproximateActionCountByAccountId} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskStepCountByAccountId,
    getTaskCommentPayload,
    getTaskNotesContentWithoutReferences,
} from "~/server/tasks/data/task_table.js";
import {AccessLevel, AccessPolicy, hasAccessLevel} from "~/shared/access/access_policy.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {InternalError, NotFoundError} from "~/shared/error/error.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    ContentMentionAccountId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessagePayload} from "~/shared/messaging/message_model.js";
import {
    SearchDynamicEntityId,
    SearchDynamicEntityIdObject,
    printSearchDynamicEntityId,
} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";
import {addFallbackToTaskTitle} from "~/shared/tasks/title/task_title.js";

const searchEntityMajorContributorCutOff = 0.2;

export type SearchEntity = {
    readonly id: SearchDynamicEntityId;
    readonly accessPolicy: SearchEntityIndexAccessPolicy;
    readonly createdTime: Date;
    readonly title: string | null;
    readonly body: string | null;
    readonly media: SearchEntityMedia | null;
    readonly embeddingChunks: ReadonlyArray<SearchEntityEmbeddingChunk>;

    // The creator is the account which created the entity. `contributorIds` are
    // the accounts which updated the entity. Contributors with value `Major`
    // are accounts that contributed more than 20% of updates to the entity.
    // Contributors with value `Minor` are accounts that contributed less than 20%
    // of updates. We pick 20% as the cutoff point based on a loose application of
    // the [pareto principle][1] (80% of the entity's meaning comes from at least
    // 20% of the updates).
    //
    // An account may be both a creator and contributor. For example, the creator
    // of a document may not be the major contributor. If there will never be
    // more than one contributor (the creator, e.g. a chat message) than
    // `contributorIds` will be empty.
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
 * For reference "The quick brown fox jumps over the lazy dog" is 9 tokens.
 * "How we’re designing our personal task management product" is 10 tokens.
 * 32 tokens (16 tokens for title, 16 tokens for section heading) is ~6% of
 * our 512 token window for Cohere's embedding models.
 *
 * 16 tokens feels like a good balance between fitting titles without taking
 * up too much space.
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
}

/**
 * Data on a `TaskCollectionModel` that influences who has access. Use this
 * interface if you're recording a dependency only on a collection's
 * `Authorization` trait.
 */
interface TaskCollectionModelForAuthorization {
    isDeleted(): boolean;
    getAccessPolicy(): AccessPolicy;
}

/**
 * Object that controls reading of a search entity. The implementations of
 * `getSearchEntity()` for each entity type (e.g. `getDocumentSearchEntity()`)
 * do not have access to a full context object! Instead, all reads must go
 * through this class which:
 *
 * 1. Tracks all dependencies read by the `getSearchEntity()` function
 * 2. Makes sure all reads use strong consistency
 *
 * It's really important that all reads use strong consistency. Or else we
 * might miss an update while executing our search indexing job. For example,
 * say you just updated your chat message. We queue an indexing job which reads
 * the chat message back. If we read the chat message with eventual consistency
 * we might get the chat message's data from before your update.
 */
class SearchEntityReadState {
    private readonly _context: SearchSystemActionContext;
    public readonly tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
    public readonly registerAdditionalWrite: (
        action: (context: SearchSystemActionContext) => Promise<void>,
    ) => void;
    private readonly _targetId: SearchDynamicEntityId;

    private readonly _dependencyIds = new Set<SearchEntityDependencyId>();

    // Cache of accounts so if an account is mentioned multiple times we don't need
    // to load it multiple times. We can't use the built-in `getAccount()` cache
    // because we need to read with strong consistency.
    //
    // It's ok to cache within the context of read state because we need strongly
    // consistent reads after construction of read state. If we pick up an account
    // from the `getAccount()` cache we don't have that guarantee.
    private readonly _accountPromiseById = new Map<
        AccountId | ContentMentionAccountId,
        Promise<AccountModelWithoutSpace | null>
    >();

    constructor(
        context: SearchSystemActionContext,
        targetId: SearchDynamicEntityId,
        {
            tokenizer,
            registerAdditionalWrite,
        }: {
            tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
            registerAdditionalWrite: (
                action: (context: SearchSystemActionContext) => Promise<void>,
            ) => void;
        },
    ) {
        // Makes sure all reads use strong consistency. We need strong consistency so
        // that we don't miss recent updates when indexing. Throws an error (in
        // development) if a read doesn't use strong consistency.
        this._context = context.dynamo.expectStrongReadConsistency();

        this.tokenizer = tokenizer;
        this.registerAdditionalWrite = registerAdditionalWrite;
        this._targetId = targetId;
    }

    /**
     * Record a dependency of the target search entity. Must be called whenever we
     * read data for this entity.
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
     * Get an account by `AccountId`. Returns `AccountModelWithoutSpace` instead
     * of `AccountModel` so that if space properties change (e.g. account is
     * removed or account permission level changes) we don't need to re-index all
     * content that references the account.
     */
    // Arrow function form so we can pass as a function parameter
    // (e.g. `chunkSearchContent(content, {getAccountIfExists: state.getAccountIfExists}))`)
    public readonly getAccountIfExists = (
        accountId: AccountId | ContentMentionAccountId,
    ): Promise<AccountModelWithoutSpace | null> => {
        this._recordDependencyId(`Account:${accountId}:WithoutSpace`);

        return getOrSetDefaultMapValue(this._accountPromiseById, accountId, async () => {
            const account = await getAccountIfExists(
                this._context,
                this._context.actor.getSpaceId(),
                accountId,
                {consistency: "Strong"},
            );
            if (!account) return null;

            return new AccountModelWithoutSpace(omitObject(account.initialData, ["space"]));
        });
    };

    public async getAccount(accountId: AccountId): Promise<AccountModelWithoutSpace> {
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

    public getDocumentContent(documentId: DocumentId): Promise<{
        createdTime: Date;
        version: number;
        content: DocumentContent;
        creatorId: AccountId | null;
        stepCountByNonCreatorAccountId: DocumentStepCountByAccountId;
        updateContentPreview: (context: ServerActionContext) => Promise<void>;
    }> {
        this._recordDependencyId(`Document:${documentId}`);

        return getDocumentContent(this._context, documentId, {
            consistency: "StrongWithinCache",
        });
    }

    public getDocumentTitle(documentId: DocumentId): Promise<string> {
        this._recordDependencyId(`Document:${documentId}:Title`);

        return getDocumentTitle(this._context, documentId, {
            consistency: "StrongWithinCache",
        });
    }

    public getDocumentCommentPayload(
        documentId: DocumentId,
        commentThreadId: DocumentCommentThreadId,
        commentIndex: number,
    ): Promise<{
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
        documentAccessPolicy: AccessPolicy;
    }> {
        this._recordDependencyId(`Document:${documentId}:Authorization`);
        this._recordDependencyId(
            `DocumentComment:${documentId}-${commentThreadId}-${commentIndex}`,
        );

        return getDocumentCommentPayload(this._context, {
            documentId,
            commentThreadId,
            commentIndex,
            consistency: "StrongWithinCache",
        });
    }

    public getChannelNameAndDescriptionContentAndContributors(channelId: ChannelId): Promise<{
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

    /**
     * When we load a post, we also load the channel the post is in. This marks the
     * channel as a dependency of our search entity.
     *
     * A post inherits permissions from its channel. We also use the channel name
     * to provide context in the post's embedding chunk.
     */
    public async getPostContentAndChannel(postId: PostId): Promise<{
        createdTime: Date;
        authorId: AccountId;
        content: PostContent;
        channel: ChannelPreviewModel;
        channelAccessPolicy: AccessPolicy;
    }> {
        this._recordDependencyId(`Post:${postId}`);

        const contentAndChannel = await getPostContentAndChannelPreview(this._context, postId, {
            consistency: "StrongWithinCache",
        });

        this._recordDependencyId(`Channel:${contentAndChannel.channel.id}:Preview`);
        return contentAndChannel;
    }

    public async getPostCommentPayload(
        postId: PostId,
        commentIndex: number,
    ): Promise<{
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
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
        return comment;
    }

    public getTaskCommentPayload(
        taskId: TaskId,
        commentIndex: number,
    ): Promise<{
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
    }> {
        this._recordDependencyId(`TaskComment:${taskId}-${commentIndex}`);

        return getTaskCommentPayload(this._context, {
            taskId,
            commentIndex,
            consistency: "StrongWithinCache",
        });
    }

    public getChatAccountIds(
        chatId: ChatId,
    ): Promise<{createdTime: Date; hasMessages: boolean; accountIds: ReadonlyArray<AccountId>}> {
        this._recordDependencyId(`Chat:${chatId}`);

        return getChatAccountIds(this._context, chatId, {
            consistency: "StrongWithinCache",
        });
    }

    public getChatMessagePayload(
        chatId: ChatId,
        messageIndex: number,
    ): Promise<{
        createdTime: Date;
        authorId: AccountId;
        payload: MessagePayload;
    }> {
        this._recordDependencyId(`ChatMessage:${chatId}-${messageIndex}`);

        return getChatMessagePayload(this._context, {
            chatId,
            messageIndex,
            consistency: "StrongWithinCache",
        });
    }

    public async getTask(taskId: TaskId): Promise<{
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
    }> {
        this._recordDependencyId(`Task:${taskId}`);

        const [
            {task, referencedTasks, referencedCollections, approximateActionCountByAccountId},
            notesContent,
        ] = await runAllPromises([
            getTaskFromIndex(this._context, this._context.actor.getSpaceId(), taskId),
            getTaskNotesContentWithoutReferences(this._context, taskId, {
                consistency: "StrongWithinCache",
            }),
        ]);

        const referencedTaskById = new Map<TaskId, TaskModel>(
            referencedTasks.map(task => {
                this._recordDependencyId(`Task:${task.id}:Authorization`);

                return [task.id, task];
            }),
        );
        const referencedCollectionById = new Map<TaskCollectionId, TaskCollectionModel>(
            referencedCollections.map(collection => {
                this._recordDependencyId(`TaskCollection:${collection.id}:Authorization`);

                return [collection.id, collection];
            }),
        );

        return {
            task,
            referencedTaskById,
            referencedCollectionById,
            approximateActionCountByAccountId,
            notesContent,
        };
    }

    public async getTaskForAuthorization(taskId: TaskId): Promise<{
        task: TaskModelForAuthorization;
        referencedTaskById: ReadonlyMap<TaskId, TaskModelForAuthorization>;
        referencedCollectionById: ReadonlyMap<
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

        const referencedTaskById = new Map<TaskId, TaskModel>(
            referencedTasks.map(task => {
                this._recordDependencyId(`Task:${task.id}:Authorization`);

                return [task.id, task];
            }),
        );
        const referencedCollectionById = new Map<TaskCollectionId, TaskCollectionModel>(
            referencedCollections.map(collection => {
                this._recordDependencyId(`TaskCollection:${collection.id}:Authorization`);

                return [collection.id, collection];
            }),
        );

        return {
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
}

function getSearchEntityIndexAccessPolicy(
    accessPolicy: AccessPolicy,
): SearchEntityIndexAccessPolicy {
    const defaultGrantType: SearchEntityIndexDefaultGrantType | null =
        accessPolicy.defaultGrant !== null ? "Space" : null;
    let accountGrantAccountIds = new Set(accessPolicy.accountGrantById.keys());

    // If we have a space default grant then the individual account grants don't
    // matter for the search entity. Lets exclude them to save space in the index.
    if (defaultGrantType !== null) {
        cast<"Space">(defaultGrantType);
        accountGrantAccountIds = new Set();
    }

    return {accountGrantAccountIds, defaultGrantType};
}

/**
 * Gets a `SearchEntity` object for any searchable thing in our system. This
 * function guarantees read-after-write consistency. If you've waited for a
 * write to commit then this function will read it (this means all DynamoDB
 * reads are made with strong consistency).
 *
 * While reading we may optionally register a function to perform additional
 * write actions. If we call this function as a part of the `IndexSearchEntity`
 * job then the additional writes will be run alongside updating our OpenSearch
 * index.
 */
export async function getSearchEntity(
    context: SearchSystemActionContext,
    idObject: SearchDynamicEntityIdObject,
    options: {
        tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
        registerAdditionalWrite: (
            action: (context: SearchSystemActionContext) => Promise<void>,
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
    accountId: AccountId | ContentMentionAccountId,
): Promise<SearchEntity> {
    const account = await state.getAccountWithSpace(accountId as AccountId);

    return {
        id: `Account:${accountId}`,

        // Anyone in a space can see all the accounts in a space.
        accessPolicy: {
            accountGrantAccountIds: emptySet,
            defaultGrantType: "Space",
        },

        createdTime: account.initialData.space.joinedTime,

        title: account.initialData.name,
        body: null,
        media: {type: "Account", accountId: accountId as AccountId},
        embeddingChunks: emptyArray,

        // Doesn't make sense that an account would create itself. So mark an account
        // has having no creator.
        creatorId: null,
        contributorIds: emptyMap,
    };
}

export const getDocumentSearchEntityTestCheckpoint = new TestCheckpoint<DocumentId>();

async function getDocumentSearchEntity(
    state: SearchEntityReadState,
    documentId: DocumentId,
): Promise<SearchEntity> {
    const {
        createdTime,
        version,
        content,
        creatorId,
        stepCountByNonCreatorAccountId,
        updateContentPreview,
    } = await state.getDocumentContent(documentId);

    // If we're running an `IndexSearchEntity` job then we also want to update the
    // document's content preview alongside updating the OpenSearch index.
    state.registerAdditionalWrite(updateContentPreview);

    await getDocumentSearchEntityTestCheckpoint.waitForTest(documentId);

    const {title, getFullText, getEmbeddingChunks} = await chunkDocumentSearchContent(
        content,
        state,
    );

    const contributorIds = new Map<AccountId, "Major" | "Minor">();
    let stepCountByNonCreatorAccounts = 0;

    for (const [nonCreatorAccountId, stepCount] of stepCountByNonCreatorAccountId.get()) {
        stepCountByNonCreatorAccounts += stepCount;

        contributorIds.set(
            nonCreatorAccountId,
            stepCount / version > searchEntityMajorContributorCutOff ? "Major" : "Minor",
        );
    }

    if (creatorId !== null) {
        contributorIds.set(
            creatorId,
            (version - stepCountByNonCreatorAccounts) / version > searchEntityMajorContributorCutOff
                ? "Major"
                : "Minor",
        );
    }

    return {
        id: `Document:${documentId}`,
        accessPolicy: getSearchEntityIndexAccessPolicy(content.attrs.accessPolicy),
        createdTime,
        title,
        body: getFullText(),
        media: null,
        embeddingChunks: getEmbeddingChunks(),
        creatorId,
        contributorIds,
    };
}

export async function chunkDocumentSearchContent(
    content: DocumentContent,
    {
        tokenizer,
        getAccountIfExists,
    }: {
        tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModelWithoutSpace | null>;
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

    // Create a copy of the document without its title. We add the title back in
    // the chunk preamble of the first chunk.
    const contentWithoutTitle = content.type.create(
        content.attrs,
        content.content.content.slice(1),
    );

    const {getFullText, getEmbeddingChunks} = await chunkSearchContent(contentWithoutTitle, {
        tokenizer,
        getAccountIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            if (isInitialChunk) return {text: `# ${title}`, lineMarginBottom: 2};

            return {
                text: `This is from the “${truncatedTitle.get()}” document${
                    context.sectionHeading !== null
                        ? ` in the “${truncatedSectionHeading.get(context.sectionHeading)}” section`
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
    const {
        createdTime,
        authorId,
        payload: commentPayload,
        documentAccessPolicy,
    } = await state.getDocumentCommentPayload(documentId, commentThreadId, commentIndex);

    const content =
        commentPayload.type === "Content"
            ? await chunkSearchContent(commentPayload.content, {
                  tokenizer: state.tokenizer,
                  getAccountIfExists: state.getAccountIfExists,
                  getChunkPreamble: ({isInitialChunk}) => {
                      return {
                          text: `This is${
                              isInitialChunk ? " a " : " from a "
                          }comment on a document:`,
                          lineMarginBottom: 2,
                      };
                  },
              })
            : null;

    return {
        id: `DocumentComment:${documentId}-${commentThreadId}-${commentIndex}`,
        accessPolicy: getSearchEntityIndexAccessPolicy(documentAccessPolicy),
        createdTime,
        title: null,
        body: content?.getFullText() ?? null,
        media: {type: "Account", accountId: authorId},
        embeddingChunks: content?.getEmbeddingChunks() ?? [],
        creatorId: authorId,
        contributorIds: emptyMap,
    };
}

async function getChannelSearchEntity(
    state: SearchEntityReadState,
    channelId: ChannelId,
): Promise<SearchEntity> {
    const channel = await state.getChannelNameAndDescriptionContentAndContributors(channelId);

    const truncatedName = new Lazy(() =>
        truncateTokens(state.tokenizer, channel.name, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const {getFullText, getEmbeddingChunks} = await chunkSearchContent(channel.description, {
        tokenizer: state.tokenizer,
        getAccountIfExists: state.getAccountIfExists,
        getChunkPreamble: ({isInitialChunk}) => {
            return {
                text: `This is${
                    isInitialChunk ? " the " : " from the "
                }description of the “${truncatedName.get()}” channel:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id: `Channel:${channelId}`,
        accessPolicy: getSearchEntityIndexAccessPolicy(channel.accessPolicy),
        createdTime: channel.createdTime,
        title: channel.name,
        body: getFullText(),
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
    };
}

async function getPostSearchEntity(
    state: SearchEntityReadState,
    postId: PostId,
): Promise<SearchEntity> {
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

    const {getFullText, getEmbeddingChunks} = await chunkSearchContent(post.content, {
        tokenizer: state.tokenizer,
        getAccountIfExists: state.getAccountIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            return {
                text: `This is${isInitialChunk ? " a " : " from a "}post${
                    context.sectionHeading !== null
                        ? ` in the “${truncatedSectionHeading.get(
                              context.sectionHeading,
                          )}” section `
                        : " "
                }in the “${truncatedChannelName.get()}” channel:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id: `Post:${postId}`,
        accessPolicy: getSearchEntityIndexAccessPolicy(post.channelAccessPolicy),
        createdTime: post.createdTime,
        title: null,
        body: getFullText(),
        media: {type: "Account", accountId: post.authorId},
        embeddingChunks: getEmbeddingChunks(),
        creatorId: post.authorId,
        contributorIds: emptyMap,
    };
}

async function getPostCommentSearchEntity(
    state: SearchEntityReadState,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<SearchEntity> {
    const {
        createdTime,
        authorId,
        payload: commentPayload,
        channelAccessPolicy,
    } = await state.getPostCommentPayload(postId, commentIndex);

    const content =
        commentPayload.type === "Content"
            ? await chunkSearchContent(commentPayload.content, {
                  tokenizer: state.tokenizer,
                  getAccountIfExists: state.getAccountIfExists,
                  getChunkPreamble: ({isInitialChunk}) => {
                      return {
                          text: `This is${isInitialChunk ? " a " : " from a "}comment on a post:`,
                          lineMarginBottom: 2,
                      };
                  },
              })
            : null;

    return {
        id: `PostComment:${postId}-${commentIndex}`,
        accessPolicy: getSearchEntityIndexAccessPolicy(channelAccessPolicy),
        createdTime,
        title: null,
        body: content?.getFullText() ?? null,
        media: {type: "Account", accountId: authorId},
        embeddingChunks: content?.getEmbeddingChunks() ?? [],
        creatorId: authorId,
        contributorIds: emptyMap,
    };
}

async function getChatSearchEntity(
    state: SearchEntityReadState,
    chatId: ChatId,
): Promise<SearchEntity> {
    const {createdTime, hasMessages, accountIds} = await state.getChatAccountIds(chatId);

    if (
        // If the chat has no messages yet, don't index any content. This means the
        // chat won't show up in search. We don't show the chat in search until it gets
        // its first message.
        !hasMessages ||
        // If a chat only has two accounts, don't index the chat. Instead you should
        // access a 1:1 chat with another account by searching for their account entity
        // (indexed by `getAccountSearchEntity()`).
        //
        // Otherwise when you search for an account's name you'll see both your 1:1
        // chat with them and their account which is a little weird.
        //
        // Also don't index the chat if it only has one account (so it's a private,
        // personal, chat). Again if you search for your account name it'll show you
        // the chat.
        accountIds.length <= 2
    ) {
        return {
            id: `Chat:${chatId}`,
            accessPolicy: {
                accountGrantAccountIds: emptySet,
                defaultGrantType: null,
            },
            createdTime,
            title: null,
            body: null,
            media: null,
            embeddingChunks: emptyArray,
            creatorId: null,
            contributorIds: emptyMap,
        };
    }

    const accounts = await runAllPromises(accountIds.map(accountId => state.getAccount(accountId)));

    const accountNames = accounts
        .map(account => account.initialData.name)
        .sort((accountName1, accountName2) => accountName1.localeCompare(accountName2));

    let title: string;
    if (accountNames.length === 0) {
        title = "";
    } else if (accountNames.length === 1) {
        title = accountNames[0]!;
    } else if (accountNames.length === 2) {
        title = `${accountNames[0]!} and ${accountNames[1]!}`;
    } else {
        title = `${accountNames.slice(0, accountNames.length - 1).join(", ")}, and ${accountNames[
            accountNames.length - 1
        ]!}`;
    }

    return {
        id: `Chat:${chatId}`,

        accessPolicy: {
            accountGrantAccountIds: new Set(accountIds),
            defaultGrantType: null,
        },

        createdTime,
        title,
        body: null,
        media:
            accountIds.length === 1
                ? {type: "Account", accountId: accountIds[0]!}
                : {type: "AccountPile", accountIds},
        embeddingChunks: emptyArray,
        creatorId: null,

        // Consider all members of the chat to be major contributors! Since the number
        // of people in the chat will generally be small.
        //
        // It's a little odd that only multi-user chats get this designation. If you
        // search for "chats I'm a contributor to" (aka "my chats") you'd expect to see
        // 1:1 chats there too but currently we don't index 1:1 chats. We only index
        // accounts.
        contributorIds: new Map(accountIds.map(accountId => [accountId, "Major"])),
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

async function getChatMessageSearchEntity(
    state: SearchEntityReadState,
    {chatId, messageIndex}: {chatId: ChatId; messageIndex: number},
): Promise<SearchEntity> {
    const [{accountIds: chatAccountIds}, {createdTime, authorId, payload: messagePayload}] =
        await runAllPromises([
            state.getChatAccountIds(chatId),
            state.getChatMessagePayload(chatId, messageIndex),
        ]);

    const content =
        messagePayload.type === "Content"
            ? await chunkSearchContent(messagePayload.content, {
                  tokenizer: state.tokenizer,
                  getAccountIfExists: state.getAccountIfExists,
                  getChunkPreamble: ({isInitialChunk}) => {
                      return {
                          text: `This is${isInitialChunk ? " a " : " from a "}message in a chat${
                              chatAccountIds.length > 1
                                  ? ` between ${
                                        nameByNumber.get(chatAccountIds.length) ??
                                        chatAccountIds.length
                                    } people`
                                  : ""
                          }:`,
                          lineMarginBottom: 2,
                      };
                  },
              })
            : null;

    return {
        id: `ChatMessage:${chatId}-${messageIndex}`,

        accessPolicy: {
            accountGrantAccountIds: new Set(chatAccountIds),
            defaultGrantType: null,
        },

        createdTime,
        title: null,
        body: content?.getFullText() ?? null,
        media: {type: "Account", accountId: authorId},
        embeddingChunks: content?.getEmbeddingChunks() ?? [],
        creatorId: authorId,
        contributorIds: emptyMap,
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
    let accountGrantAccountIds = new Set<AccountId>();

    const trackTaskDependencies = (task: TaskModelForAuthorization) => {
        if (hasAccessLevel("Edit", expectedAccessLevel)) {
            accountGrantAccountIds.add(task.getCreator().accountId);
        }

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

    // If we have a space default grant then the individual account grants don't
    // matter for the search entity. Lets exclude them to save space in the index.
    if (defaultGrantType !== null) {
        cast<"Space">(defaultGrantType);
        accountGrantAccountIds = new Set();
    }

    return {
        accountGrantAccountIds,
        defaultGrantType,
    };
}

async function getTaskSearchEntity(
    state: SearchEntityReadState,
    taskId: TaskId,
): Promise<SearchEntity> {
    const {
        task,
        referencedTaskById,
        referencedCollectionById,
        approximateActionCountByAccountId: approximateActionCountByAccountIdWithoutNotesStepCount,
        notesContent,
    } = await state.getTask(taskId);

    // Index no content for deleted tasks.
    if (task.isDeleted()) {
        return {
            id: `Task:${taskId}`,
            accessPolicy: {accountGrantAccountIds: emptySet, defaultGrantType: null},
            createdTime: new Date(task.getCreatedTime().absoluteTime[0]),
            title: null,
            body: null,
            media: null,
            embeddingChunks: emptyArray,
            creatorId: null,
            contributorIds: emptyMap,
        };
    }

    const accessPolicy = getTaskSearchEntityAccessPolicy({
        task,
        referencedTaskById,
        referencedCollectionById,
        expectedAccessLevel: "View",
    });

    const title = addFallbackToTaskTitle(task.getTitle().getText());

    const truncatedTitle = new Lazy(() =>
        truncateTokens(state.tokenizer, title, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(
            state.tokenizer,
            sectionHeading,
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const notesChunkResult = !isContentEmpty(notesContent.content)
        ? await chunkSearchContent(notesContent.content, {
              tokenizer: state.tokenizer,
              getAccountIfExists: state.getAccountIfExists,
              getChunkPreamble: ({context, isInitialChunk}) => {
                  if (isInitialChunk) return {text: `# ${title}`, lineMarginBottom: 2};

                  return {
                      text: `This is from the “${truncatedTitle.get()}” task${
                          context.sectionHeading !== null
                              ? ` in the “${truncatedSectionHeading.get(
                                    context.sectionHeading,
                                )}” section`
                              : ""
                      }:`,
                      lineMarginBottom: 2,
                  };
              },
          })
        : null;

    // Calculate task contributors. For tasks we have discrete updates (update
    // assignee, update priority) and continuous updates (update title, update
    // notes). If an account has >20% contributions in either the discrete or
    // continuous category then we consider it a major contributor.
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
                    // actions then we consider it to be a major contributor. It's not really fair
                    // to compare major and discrete actions.
                    continuousActionCount / totalApproximateContinuousActionCount >
                        searchEntityMajorContributorCutOff ||
                    discreteActionCount / totalApproximateDiscreteActionCount >
                        searchEntityMajorContributorCutOff
                        ? "Major"
                        : "Minor",
                ],
            ),
        );
    }

    return {
        id: `Task:${taskId}`,
        accessPolicy,
        createdTime: new Date(task.getCreatedTime().absoluteTime[0]),
        title,
        body: notesChunkResult?.getFullText() ?? null,
        media: {type: "TaskDisplayStatus", displayStatus: task.getDisplayStatus()},
        embeddingChunks: notesChunkResult?.getEmbeddingChunks() ?? [],
        creatorId: task.getCreator().accountId,
        contributorIds,
    };
}

async function getTaskCollectionSearchEntity(
    state: SearchEntityReadState,
    collectionId: TaskCollectionId,
): Promise<SearchEntity> {
    const collection = await state.getTaskCollection(collectionId);
    const accessPolicy = collection.getAccessPolicy();

    // Index no content for deleted collections.
    if (collection.isDeleted()) {
        return {
            id: `TaskCollection:${collectionId}`,
            accessPolicy: {accountGrantAccountIds: emptySet, defaultGrantType: null},
            createdTime: new Date(collection.getCreatedTime()[0]),
            title: null,
            body: null,
            media: null,
            embeddingChunks: emptyArray,
            creatorId: null,
            contributorIds: emptyMap,
        };
    }

    return {
        id: `TaskCollection:${collectionId}`,
        accessPolicy: getSearchEntityIndexAccessPolicy(accessPolicy),
        createdTime: new Date(collection.getCreatedTime()[0]),
        title: collection.getName(),
        body: null,
        media: {type: "TaskCollectionColor", color: collection.getColor()},
        embeddingChunks: emptyArray,
        creatorId: collection.rawData.creatorId,
        // In the future we could keep track of which accounts were adding tasks to the
        // collection to answer queries like "collections I've added tasks to".
        contributorIds: emptyMap,
    };
}

async function getTaskCommentSearchEntity(
    state: SearchEntityReadState,
    {taskId, commentIndex}: {taskId: TaskId; commentIndex: number},
): Promise<SearchEntity> {
    const [
        {task, referencedTaskById, referencedCollectionById},
        {createdTime, authorId, payload: commentPayload},
    ] = await runAllPromises([
        state.getTaskForAuthorization(taskId),
        state.getTaskCommentPayload(taskId, commentIndex),
    ]);

    const accessPolicy = getTaskSearchEntityAccessPolicy({
        task,
        referencedTaskById,
        referencedCollectionById,
        expectedAccessLevel: "Comment",
    });

    const content =
        commentPayload.type === "Content"
            ? await chunkSearchContent(commentPayload.content, {
                  tokenizer: state.tokenizer,
                  getAccountIfExists: state.getAccountIfExists,
                  getChunkPreamble: ({isInitialChunk}) => {
                      return {
                          text: `This is${isInitialChunk ? " a " : " from a "}comment on a task:`,
                          lineMarginBottom: 2,
                      };
                  },
              })
            : null;

    return {
        id: `TaskComment:${taskId}-${commentIndex}`,
        accessPolicy,
        createdTime,
        title: null,
        body: content?.getFullText() ?? null,
        media: {type: "Account", accountId: authorId},
        embeddingChunks: content?.getEmbeddingChunks() ?? [],
        creatorId: authorId,
        contributorIds: emptyMap,
    };
}
