import {getChatAccountIds, getChatMessagePayload} from "~/server/chat/data/chat_table.js";
import {
    getDocumentCommentPayload,
    getDocumentContent,
    getDocumentTitle,
} from "~/server/documents/data/documents_table.js";
import {
    getChannelNameAndDescriptionContent,
    getChannelPreview,
    getPostCommentPayload,
    getPostContentAndChannel,
} from "~/server/forum/data/forum_table.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {CohereEmbedEnglishV3LanguageTokenizer} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_tokenizer.js";
import {
    SearchEntityDependencyId,
    isSearchEntityDependencyIdAlsoEntityId,
    isSearchEntityIdAlsoEntityDependencyId,
} from "~/server/search/core/search_entity_dependency_id.js";
import {chunkSearchContent} from "~/server/search/data/internal/chunk_search_content.js";
import {
    SearchEntityIndexAccessPolicy,
    SearchEntityIndexDefaultGrantType,
} from "~/server/search/data/internal/search_entity_index_doc.js";
import {truncateTokens} from "~/server/search/data/internal/truncate_tokens.js";
import {SearchEntityIndexSystemActionContext} from "~/server/search/data/search_entity_index_system_action_context.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {getTaskNotesContentWithoutReferences} from "~/server/tasks/data/task_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {InternalError, NotFoundError} from "~/shared/error/error.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
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
    SearchEntityId,
    SearchEntityIdObject,
    printSearchEntityId,
} from "~/shared/search/search_entity_id.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {addFallbackToTaskTitle} from "~/shared/tasks/model/task_title_model.js";
import {TaskNotesContent} from "~/shared/tasks/task_notes_content_schema.js";

export type SearchEntity = {
    readonly id: SearchEntityId;
    readonly accessPolicy: SearchEntityIndexAccessPolicy;
    readonly createdTime: Date;
    readonly title: string | null;
    readonly body: string | null;
    readonly embeddingChunks: ReadonlyArray<SearchEntityEmbeddingChunk>;
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
// TODO(calebmer): It would be nice someday to have some developer tool to make
// sure essential DynamoDB reads have strong consistency. Maybe we have an
// eventual consistency read logger? Or even throw in development?
//
// We could also use this tool in `notifications_table.ts` since it's important
// the `getSubscribers()` function has strong read consistency for similar
// reasons.
class SearchEntityReadState {
    private readonly _context: SearchEntityIndexSystemActionContext;
    public readonly tokenizer: CohereEmbedEnglishV3LanguageTokenizer;
    private readonly _targetId: SearchEntityId;

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
        Promise<AccountModel | null>
    >();

    constructor(
        context: SearchEntityIndexSystemActionContext,
        tokenizer: CohereEmbedEnglishV3LanguageTokenizer,
        targetId: SearchEntityId,
    ) {
        this._context = context;
        this.tokenizer = tokenizer;
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
    private _recordDependencyId(id: SearchEntityId | SearchEntityDependencyId) {
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

    // Arrow function form so we can pass as a function parameter
    // (e.g. `chunkSearchContent(content, {getAccountIfExists: state.getAccountIfExists}))`)
    public readonly getAccountIfExists = (
        accountId: AccountId | ContentMentionAccountId,
    ): Promise<AccountModel | null> => {
        this._recordDependencyId(`Account:${accountId}`);

        return getOrSetDefaultMapValue(this._accountPromiseById, accountId, () =>
            getAccountIfExists(this._context, this._context.actor.getSpaceId(), accountId, {
                consistency: "Strong",
            }),
        );
    };

    public async getAccount(accountId: AccountId): Promise<AccountModel> {
        const account = await this.getAccountIfExists(accountId);
        if (!account) throw new NotFoundError("Account not found");
        return account;
    }

    public getDocumentContent(
        documentId: DocumentId,
    ): Promise<{createdTime: Date; content: DocumentContent}> {
        this._recordDependencyId(`Document:${documentId}`);

        return getDocumentContent(this._context, documentId, {
            consistency: "Strong",
        });
    }

    public getDocumentTitle(documentId: DocumentId): Promise<string> {
        this._recordDependencyId(`Document:${documentId}:Title`);

        return getDocumentTitle(this._context, documentId, {
            consistency: "Strong",
        });
    }

    public getDocumentCommentPayload(
        documentId: DocumentId,
        commentThreadId: DocumentCommentThreadId,
        commentIndex: number,
    ): Promise<{createdTime: Date; payload: MessagePayload}> {
        this._recordDependencyId(
            `DocumentComment:${documentId}-${commentThreadId}-${commentIndex}`,
        );

        return getDocumentCommentPayload(this._context, {
            documentId,
            commentThreadId,
            commentIndex,
            consistency: "Strong",
        });
    }

    public getChannelNameAndDescriptionContent(
        channelId: ChannelId,
    ): Promise<{name: string; description: MessageContent; createdTime: Date}> {
        this._recordDependencyId(`Channel:${channelId}`);

        return getChannelNameAndDescriptionContent(this._context, channelId, {
            consistency: "Strong",
        });
    }

    public getChannelPreview(channelId: ChannelId): Promise<ChannelPreviewModel> {
        this._recordDependencyId(`Channel:${channelId}:Preview`);

        return getChannelPreview(this._context, channelId, {
            consistency: "Strong",
        });
    }

    /**
     * When we load a post, we also load the channel the post is in. This marks the
     * channel as a dependency of our search entity.
     *
     * A post inherits permissions from its channel. We also use the channel name
     * to provide context in the post's embedding chunk.
     */
    public async getPostContentAndChannel(
        postId: PostId,
    ): Promise<{createdTime: Date; content: PostContent; channel: ChannelPreviewModel}> {
        this._recordDependencyId(`Post:${postId}`);

        const contentAndChannel = await getPostContentAndChannel(this._context, postId, {
            consistency: "Strong",
        });

        this._recordDependencyId(`Channel:${contentAndChannel.channel.id}:Preview`);
        return contentAndChannel;
    }

    public getPostCommentPayload(
        postId: PostId,
        commentIndex: number,
    ): Promise<{createdTime: Date; payload: MessagePayload}> {
        this._recordDependencyId(`PostComment:${postId}-${commentIndex}`);

        return getPostCommentPayload(this._context, {
            postId,
            commentIndex,
            consistency: "Strong",
        });
    }

    public getChatAccountIds(
        chatId: ChatId,
    ): Promise<{createdTime: Date; accountIds: ReadonlyArray<AccountId>}> {
        this._recordDependencyId(`Chat:${chatId}`);

        return getChatAccountIds(this._context, chatId, {
            consistency: "Strong",
        });
    }

    public getChatMessagePayload(
        chatId: ChatId,
        messageIndex: number,
    ): Promise<{createdTime: Date; payload: MessagePayload}> {
        this._recordDependencyId(`ChatMessage:${chatId}-${messageIndex}`);

        return getChatMessagePayload(this._context, {
            chatId,
            messageIndex,
            consistency: "Strong",
        });
    }

    public async getTask(taskId: TaskId): Promise<{
        task: TaskModel;
        referencedTaskById: ReadonlyMap<TaskId, TaskModel>;
        referencedCollectionById: ReadonlyMap<TaskCollectionId, TaskCollectionModel>;
        notesContent: {
            version: number;
            content: TaskNotesContent;
        };
    }> {
        this._recordDependencyId(`Task:${taskId}`);

        const [{task, referencedTasks, referencedCollections}, notesContent] = await runAllPromises(
            [
                this._context.tasks.getTask(this._context.actor.getSpaceId(), taskId),
                getTaskNotesContentWithoutReferences(this._context, taskId, {
                    consistency: "Strong",
                }),
            ],
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
            notesContent,
        };
    }

    public async getTaskCollection(collectionId: TaskCollectionId): Promise<TaskCollectionModel> {
        this._recordDependencyId(`TaskCollection:${collectionId}`);

        const {collection} = await this._context.tasks.getCollection(
            this._context.actor.getSpaceId(),
            collectionId,
        );

        return collection;
    }
}

/**
 * Gets a `SearchEntity` object for any searchable thing in our system. This
 * function guarantees read-after-write consistency. If you've waited for a
 * write to commit then this function will read it (this means all DynamoDB
 * reads are made with strong consistency).
 */
export async function getSearchEntity(
    context: SearchEntityIndexSystemActionContext,
    idObject: SearchEntityIdObject,
    tokenizer: CohereEmbedEnglishV3LanguageTokenizer,
): Promise<{
    id: SearchEntityId;
    dependencyIds: Iterable<SearchEntityDependencyId>;
    entity: SearchEntity;
}> {
    const id = printSearchEntityId(idObject);

    const state = new SearchEntityReadState(context, tokenizer, id);

    const entity = await actuallyGetSearchEntity(state, idObject);

    return {
        id,
        dependencyIds: state.getDependencyIds(),
        entity,
    };
}

async function actuallyGetSearchEntity(
    state: SearchEntityReadState,
    idObject: SearchEntityIdObject,
) {
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
        default:
            throw exhaustive(idObject);
    }
}

async function getAccountSearchEntity(
    state: SearchEntityReadState,
    accountId: AccountId,
): Promise<SearchEntity> {
    const account = await state.getAccount(accountId);

    return {
        id: `Account:${accountId}`,

        // Anyone in a space can see all the accounts in a space.
        accessPolicy: {
            accountGrantAccountIds: new Set(),
            defaultGrantType: "Space",
        },

        // TODO(calebmer): Maybe this should be when the account was added to the space
        // instead of when the account itself was created?
        createdTime: account.initialData.createdTime,

        title: account.initialData.name,
        body: null,
        embeddingChunks: [],
    };
}

export const getDocumentSearchEntityTestCheckpoint = new TestCheckpoint<DocumentId>();

async function getDocumentSearchEntity(
    state: SearchEntityReadState,
    documentId: DocumentId,
): Promise<SearchEntity> {
    const {createdTime, content} = await state.getDocumentContent(documentId);
    await getDocumentSearchEntityTestCheckpoint.waitForTest(documentId);

    const {title, getFullText, embeddingChunks} = await chunkDocumentSearchContent(content, state);

    return {
        id: `Document:${documentId}`,

        // TODO(calebmer): Documents are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: new Set(),
            defaultGrantType: "Space",
        },

        createdTime,
        title,
        body: getFullText(),
        embeddingChunks,
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
        ) => Promise<AccountModel | null>;
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

    const {getFullText, embeddingChunks} = await chunkSearchContent(contentWithoutTitle, {
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

    return {title, getFullText, embeddingChunks};
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
    const {createdTime, payload: commentPayload} = await state.getDocumentCommentPayload(
        documentId,
        commentThreadId,
        commentIndex,
    );

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

        // TODO(calebmer): Documents are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: new Set(),
            defaultGrantType: "Space",
        },

        createdTime,
        title: null,
        body: content?.getFullText() ?? null,
        embeddingChunks: content?.embeddingChunks ?? [],
    };
}

async function getChannelSearchEntity(
    state: SearchEntityReadState,
    channelId: ChannelId,
): Promise<SearchEntity> {
    const channel = await state.getChannelNameAndDescriptionContent(channelId);

    const truncatedName = new Lazy(() =>
        truncateTokens(state.tokenizer, channel.name, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const {getFullText, embeddingChunks} = await chunkSearchContent(channel.description, {
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

        // TODO(calebmer): Channels are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: new Set(),
            defaultGrantType: "Space",
        },

        createdTime: channel.createdTime,
        title: channel.name,
        body: getFullText(),
        embeddingChunks,
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

    const {getFullText, embeddingChunks} = await chunkSearchContent(post.content, {
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

        // TODO(calebmer): Channels are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: new Set(),
            defaultGrantType: "Space",
        },

        createdTime: post.createdTime,

        // TODO(calebmer): We can sometimes infer a title from a post if the post uses
        // headings. Should consider doing this and using the information to improve
        // search indexing.
        //
        // Or maybe we should use an LLM to figure out a title for posts when there is
        // no heading? If the post is of a certain length.
        title: null,

        body: getFullText(),
        embeddingChunks,
    };
}

async function getPostCommentSearchEntity(
    state: SearchEntityReadState,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<SearchEntity> {
    const {createdTime, payload: commentPayload} = await state.getPostCommentPayload(
        postId,
        commentIndex,
    );

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

        // TODO(calebmer): Documents are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: new Set(),
            defaultGrantType: "Space",
        },

        createdTime,
        title: null,
        body: content?.getFullText() ?? null,
        embeddingChunks: content?.embeddingChunks ?? [],
    };
}

async function getChatSearchEntity(
    state: SearchEntityReadState,
    chatId: ChatId,
): Promise<SearchEntity> {
    const {createdTime, accountIds} = await state.getChatAccountIds(chatId);

    const accounts = await runAllPromises(accountIds.map(accountId => state.getAccount(accountId)));

    const accountNames = accounts.map(account => account.initialData.name);

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
        embeddingChunks: [],
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
    const [{accountIds: chatAccountIds}, {createdTime, payload: messagePayload}] =
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
        embeddingChunks: content?.embeddingChunks ?? [],
    };
}

async function getTaskSearchEntity(
    state: SearchEntityReadState,
    taskId: TaskId,
): Promise<SearchEntity> {
    const {task, referencedTaskById, referencedCollectionById, notesContent} = await state.getTask(
        taskId,
    );

    let defaultGrantType: SearchEntityIndexDefaultGrantType | null = null;
    let accountGrantAccountIds = new Set<AccountId>();

    const trackTaskDependencies = (task: TaskModel) => {
        accountGrantAccountIds.add(task.getCreator().accountId);

        const assignee = task.getAssignee();
        if (assignee) {
            accountGrantAccountIds.add(assignee.assignee.accountId);
        }

        for (const {collectionId} of task.getCollections().getArray()) {
            // Assert is safe since all referenced collections should have loaded.
            const collection = assertExists(referencedCollectionById.get(collectionId));

            // Deleted collections don't contribute to the access policy...
            if (collection.isDeleted()) continue;

            const accessPolicy = collection.getAccessPolicy();

            if (accessPolicy.defaultGrant !== null) {
                if (defaultGrantType === null) {
                    defaultGrantType = accessPolicy.defaultGrant.type;
                } else {
                    // If we add new default grant types in the future, we'll need to merge the
                    // default grants to the one which gives the most access.
                    cast<"Space">(defaultGrantType);
                    cast<"Space">(accessPolicy.defaultGrant.type);
                }
            }

            for (const accountId of accessPolicy.accountGrantById.keys()) {
                accountGrantAccountIds.add(accountId);
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

    // Index no content for deleted tasks.
    if (task.isDeleted()) {
        return {
            id: `Task:${taskId}`,
            accessPolicy: {accountGrantAccountIds: new Set(), defaultGrantType: null},
            createdTime: new Date(task.getCreatedTime().absoluteTime[0]),
            title: null,
            body: null,
            embeddingChunks: [],
        };
    }

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

    const {getFullText, embeddingChunks} = await chunkSearchContent(notesContent.content, {
        tokenizer: state.tokenizer,
        getAccountIfExists: state.getAccountIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            if (isInitialChunk) return {text: `# ${title}`, lineMarginBottom: 2};

            return {
                text: `This is from the “${truncatedTitle.get()}” task${
                    context.sectionHeading !== null
                        ? ` in the “${truncatedSectionHeading.get(context.sectionHeading)}” section`
                        : ""
                }:`,
                lineMarginBottom: 2,
            };
        },
    });

    return {
        id: `Task:${taskId}`,
        accessPolicy: {accountGrantAccountIds, defaultGrantType},
        createdTime: new Date(task.getCreatedTime().absoluteTime[0]),
        title,
        body: getFullText(),
        embeddingChunks,
    };
}

async function getTaskCollectionSearchEntity(
    state: SearchEntityReadState,
    collectionId: TaskCollectionId,
): Promise<SearchEntity> {
    const collection = await state.getTaskCollection(collectionId);
    const accessPolicy = collection.getAccessPolicy();

    const defaultGrantType: SearchEntityIndexDefaultGrantType | null =
        accessPolicy.defaultGrant?.type ?? null;
    let accountGrantAccountIds = new Set(accessPolicy.accountGrantById.keys());

    // If we have a space default grant then the individual account grants don't
    // matter for the search entity. Lets exclude them to save space in the index.
    if (defaultGrantType !== null) {
        cast<"Space">(defaultGrantType);
        accountGrantAccountIds = new Set();
    }

    // Index no content for deleted collections.
    if (collection.isDeleted()) {
        return {
            id: `TaskCollection:${collectionId}`,
            accessPolicy: {accountGrantAccountIds: new Set(), defaultGrantType: null},
            createdTime: new Date(collection.getCreatedTime()[0]),
            title: null,
            body: null,
            embeddingChunks: [],
        };
    }

    return {
        id: `TaskCollection:${collectionId}`,
        accessPolicy: {accountGrantAccountIds, defaultGrantType},
        createdTime: new Date(collection.getCreatedTime()[0]),
        title: collection.getName(),
        body: null,
        embeddingChunks: [],
    };
}
