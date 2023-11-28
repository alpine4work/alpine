import {getChatAccountIds, getChatMessagePayload} from "~/server/chat/data/chat_table.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
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
import {chunkSearchContent} from "~/server/search/data/internal/chunk_search_content.js";
import {CohereEnglishLightLanguageModel} from "~/server/search/data/internal/cohere_english_light_language_model.js";
import {LanguageModelBase} from "~/server/search/data/internal/language_model_base.js";
import {SearchEntityDependencyId} from "~/server/search/data/internal/search_entity_dependency_id.js";
import {SearchEntityId} from "~/server/search/data/internal/search_entity_id.js";
import {
    SearchEntityIndexAccessPolicy,
    SearchEntityIndexDefaultGrantType,
} from "~/server/search/data/internal/search_entity_index_doc.js";
import {truncateTokens} from "~/server/search/data/internal/truncate_tokens.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {getTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {Context} from "~/shared/context/context.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {NotFoundError} from "~/shared/error/error.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
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
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

// NOCOMMIT: Small messages like "Nice!" shouldn't be embedded at all?

type SearchEntity = {
    readonly id: SearchEntityId;
    readonly accessPolicy: SearchEntityIndexAccessPolicy;
    readonly title: string | null;
    readonly body: string | null;
    readonly embeddingChunks: ReadonlyArray<{
        readonly preambleEndIndex: number;
        readonly tokenCountWithoutPreamble: number;
        readonly text: string;
    }>;
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

class SearchEntityIndexer {
    private readonly _context: Context<
        ServerSystemActionContextModules & {tasks: TaskContextModule}
    >;
    public readonly model: LanguageModelBase;

    private readonly _dependencyIds = new Set<SearchEntityDependencyId>();

    private constructor(
        context: Context<ServerSystemActionContextModules & {tasks: TaskContextModule}>,
        model: LanguageModelBase,
    ) {
        this._context = context;
        this.model = model;
    }

    public static async new(
        context: Context<ServerSystemActionContextModules & {tasks: TaskContextModule}>,
    ) {
        const model = await CohereEnglishLightLanguageModel.get();
        return new SearchEntityIndexer(context, model);
    }

    // Arrow function form so we can pass as a function parameter
    // (e.g. `chunkSearchContent(content, {getAccountIfExists: indexer.getAccountIfExists}))`)
    public readonly getAccountIfExists = (
        accountId: AccountId | ContentMentionAccountId,
    ): Promise<AccountModel | null> => {
        this._dependencyIds.add(`Account:${accountId}`);
        return getAccountIfExists(this._context, this._context.actor.getSpaceId(), accountId);
    };

    public async getAccount(accountId: AccountId): Promise<AccountModel> {
        const account = await this.getAccountIfExists(accountId);
        if (!account) throw new NotFoundError("Account not found");
        return account;
    }

    public getDocumentContent(documentId: DocumentId): Promise<DocumentContent> {
        this._dependencyIds.add(`Document:${documentId}:Content`);
        return getDocumentContent(this._context, documentId);
    }

    public getDocumentTitle(documentId: DocumentId): Promise<string> {
        this._dependencyIds.add(`Document:${documentId}:Title`);
        return getDocumentTitle(this._context, documentId);
    }

    public getDocumentCommentPayload(
        documentId: DocumentId,
        commentThreadId: DocumentCommentThreadId,
        commentIndex: number,
    ): Promise<MessagePayload> {
        this._dependencyIds.add(
            `DocumentComment:${documentId}-${commentThreadId}-${commentIndex}:Payload`,
        );
        return getDocumentCommentPayload(this._context, {
            documentId,
            commentThreadId,
            commentIndex,
        });
    }

    public getChannelNameAndDescriptionContent(
        channelId: ChannelId,
    ): Promise<{name: string; description: MessageContent}> {
        this._dependencyIds.add(`Channel:${channelId}:NameAndDescriptionContent`);
        return getChannelNameAndDescriptionContent(this._context, channelId);
    }

    public getChannelPreview(channelId: ChannelId): Promise<ChannelPreviewModel> {
        this._dependencyIds.add(`Channel:${channelId}:Preview`);
        return getChannelPreview(this._context, channelId);
    }

    // NOCOMMIT: Channel should be added as an implicit dependency
    public async getPostContentAndChannel(
        postId: PostId,
    ): Promise<{content: PostContent; channel: ChannelPreviewModel}> {
        this._dependencyIds.add(`Post:${postId}:Content`);
        const contentAndChannel = await getPostContentAndChannel(this._context, postId);
        this._dependencyIds.add(`Channel:${contentAndChannel.channel.id}:Preview`);
        return contentAndChannel;
    }

    public getPostCommentPayload(postId: PostId, commentIndex: number): Promise<MessagePayload> {
        this._dependencyIds.add(`PostComment:${postId}-${commentIndex}:Payload`);
        return getPostCommentPayload(this._context, {postId, commentIndex});
    }

    public getChatAccountIds(chatId: ChatId): Promise<ReadonlyArray<AccountId>> {
        this._dependencyIds.add(`Chat:${chatId}:AccountIds`);
        return getChatAccountIds(this._context, chatId);
    }

    public getChatMessagePayload(chatId: ChatId, messageIndex: number): Promise<MessagePayload> {
        this._dependencyIds.add(`ChatMessage:${chatId}-${messageIndex}:Payload`);
        return getChatMessagePayload(this._context, {chatId, messageIndex});
    }

    public async getTask(taskId: TaskId): Promise<{
        task: TaskModel;
        referencedTaskById: ReadonlyMap<TaskId, TaskModel>;
        referencedCollectionById: ReadonlyMap<TaskCollectionId, TaskCollectionModel>;
        notesContent: {
            version: number;
            content: TaskNotesContentWithReferences;
        };
    }> {
        this._dependencyIds.add(`Task:${taskId}`);

        const [{task, referencedTasks, referencedCollections}, notesContent] = await runAllPromises(
            [
                this._context.tasks.getTask(this._context.actor.getSpaceId(), taskId),
                getTaskNotesContent(this._context, taskId),
            ],
        );

        const referencedTaskById = new Map<TaskId, TaskModel>(
            referencedTasks.map(task => {
                this._dependencyIds.add(`Task:${task.id}:Authorization`);

                return [task.id, task];
            }),
        );
        const referencedCollectionById = new Map<TaskCollectionId, TaskCollectionModel>(
            referencedCollections.map(collection => {
                this._dependencyIds.add(`TaskCollection:${collection.id}:Authorization`);

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
        this._dependencyIds.add(`TaskCollection:${collectionId}`);

        const {collection} = await this._context.tasks.getCollection(
            this._context.actor.getSpaceId(),
            collectionId,
        );

        return collection;
    }
}

export function indexSearchEntity() {
    // NOCOMMIT
}

async function indexAccountSearchEntity(
    indexer: SearchEntityIndexer,
    accountId: AccountId,
): Promise<SearchEntity> {
    const account = await indexer.getAccount(accountId);

    return {
        id: `Account:${accountId}`,

        // Anyone in a space can see all the accounts in a space.
        accessPolicy: {
            accountGrantAccountIds: new Set(),
            defaultGrantType: "Space",
        },

        title: account.initialData.name,
        body: null,
        embeddingChunks: [],
    };
}

async function indexDocumentSearchEntity(
    indexer: SearchEntityIndexer,
    documentId: DocumentId,
): Promise<SearchEntity> {
    const content = await indexer.getDocumentContent(documentId);

    const {title, getFullText, embeddingChunks} = await chunkDocumentSearchContent(
        content,
        indexer,
    );

    return {
        id: `Document:${documentId}`,

        // TODO(calebmer): Documents are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: new Set(),
            defaultGrantType: "Space",
        },

        title,
        body: getFullText(),
        embeddingChunks,
    };
}

export async function chunkDocumentSearchContent(
    content: DocumentContent,
    {
        model,
        getAccountIfExists,
    }: {
        model: LanguageModelBase;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModel | null>;
    },
) {
    const title = getDocumentContentTitle(content);

    const truncatedTitle = new Lazy(() =>
        truncateTokens(model, title, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(model, sectionHeading, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    assert(content.firstChild?.type.name === "title");

    // Create a copy of the document without its title. We add the title back in
    // the chunk preamble of the first chunk.
    const contentWithoutTitle = content.type.create(
        content.attrs,
        content.content.content.slice(1),
    );

    const {getFullText, embeddingChunks} = await chunkSearchContent(contentWithoutTitle, {
        model,
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

async function indexDocumentCommentSearchEntity(
    indexer: SearchEntityIndexer,
    documentId: DocumentId,
    commentThreadId: DocumentCommentThreadId,
    commentIndex: number,
): Promise<SearchEntity> {
    const commentPayload = await indexer.getDocumentCommentPayload(
        documentId,
        commentThreadId,
        commentIndex,
    );

    const content =
        commentPayload.type === "Content"
            ? await chunkSearchContent(commentPayload.content, {
                  model: indexer.model,
                  getAccountIfExists: indexer.getAccountIfExists,
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

        // NOCOMMIT: How does deleted stuff work? If `title` is null and `body` is null
        // and `embeddingChunks` is empty we should probably delete from the index?
        title: null,
        body: content?.getFullText() ?? null,
        embeddingChunks: content?.embeddingChunks ?? [],
    };
}

async function indexChannelSearchEntity(
    indexer: SearchEntityIndexer,
    channelId: ChannelId,
): Promise<SearchEntity> {
    const channel = await indexer.getChannelNameAndDescriptionContent(channelId);

    const truncatedName = new Lazy(() =>
        truncateTokens(indexer.model, channel.name, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const {getFullText, embeddingChunks} = await chunkSearchContent(channel.description, {
        model: indexer.model,
        getAccountIfExists: indexer.getAccountIfExists,
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

        title: channel.name,
        body: getFullText(),
        embeddingChunks,
    };
}

async function indexPostSearchEntity(
    indexer: SearchEntityIndexer,
    postId: PostId,
): Promise<SearchEntity> {
    const post = await indexer.getPostContentAndChannel(postId);

    const truncatedChannelName = new Lazy(() =>
        truncateTokens(
            indexer.model,
            post.channel.name,
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(indexer.model, sectionHeading, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const {getFullText, embeddingChunks} = await chunkSearchContent(post.content, {
        model: indexer.model,
        getAccountIfExists: indexer.getAccountIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            return {
                text: `This is${isInitialChunk ? " a " : " from a "}post ${
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

async function indexPostCommentSearchEntity(
    indexer: SearchEntityIndexer,
    postId: PostId,
    commentIndex: number,
): Promise<SearchEntity> {
    const commentPayload = await indexer.getPostCommentPayload(postId, commentIndex);

    const content =
        commentPayload.type === "Content"
            ? await chunkSearchContent(commentPayload.content, {
                  model: indexer.model,
                  getAccountIfExists: indexer.getAccountIfExists,
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

        // NOCOMMIT: How does deleted stuff work? If `title` is null and `body` is null
        // and `embeddingChunks` is empty we should probably delete from the index?
        title: null,
        body: content?.getFullText() ?? null,
        embeddingChunks: content?.embeddingChunks ?? [],
    };
}

async function indexChatSearchEntity(
    indexer: SearchEntityIndexer,
    chatId: ChatId,
): Promise<SearchEntity> {
    const accountIds = await indexer.getChatAccountIds(chatId);

    const accounts = await runAllPromises(
        accountIds.map(accountId => indexer.getAccount(accountId)),
    );

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

async function indexChatMessageSearchEntity(
    indexer: SearchEntityIndexer,
    chatId: ChatId,
    messageIndex: number,
): Promise<SearchEntity> {
    const [chatAccountIds, messagePayload] = await runAllPromises([
        indexer.getChatAccountIds(chatId),
        indexer.getChatMessagePayload(chatId, messageIndex),
    ]);

    const content =
        messagePayload.type === "Content"
            ? await chunkSearchContent(messagePayload.content, {
                  model: indexer.model,
                  getAccountIfExists: indexer.getAccountIfExists,
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

        // NOCOMMIT: How does deleted stuff work? If `title` is null and `body` is null
        // and `embeddingChunks` is empty we should probably delete from the index?
        title: null,
        body: content?.getFullText() ?? null,
        embeddingChunks: content?.embeddingChunks ?? [],
    };
}

async function indexTaskSearchEntity(
    indexer: SearchEntityIndexer,
    taskId: TaskId,
): Promise<SearchEntity> {
    const {task, referencedTaskById, referencedCollectionById, notesContent} =
        await indexer.getTask(taskId);

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

                for (const accountId of accessPolicy.accountGrantById.keys()) {
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

    const truncatedTitle = new Lazy(() =>
        truncateTokens(
            indexer.model,
            task.getTitle().getText(),
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(indexer.model, sectionHeading, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const {getFullText, embeddingChunks} = await chunkSearchContent(notesContent.content.doc, {
        model: indexer.model,
        getAccountIfExists: indexer.getAccountIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            if (isInitialChunk)
                return {text: `# ${task.getTitle().getText()}`, lineMarginBottom: 2};

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

        accessPolicy: {
            accountGrantAccountIds,
            defaultGrantType,
        },

        title: task.getTitle().getText(),
        body: getFullText(),
        embeddingChunks,
    };
}

async function indexTaskCollectionSearchEntity(
    indexer: SearchEntityIndexer,
    collectionId: TaskCollectionId,
): Promise<SearchEntity> {
    const collection = await indexer.getTaskCollection(collectionId);
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

    return {
        id: `TaskCollection:${collectionId}`,

        accessPolicy: {
            accountGrantAccountIds,
            defaultGrantType,
        },

        title: collection.getName(),
        body: null,
        embeddingChunks: [],
    };
}
