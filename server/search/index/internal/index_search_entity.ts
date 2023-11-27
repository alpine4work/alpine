import {getChat, getChatMessage} from "~/server/chat/data/chat_table.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {
    getDocument,
    getDocumentComment,
    getDocumentPreview,
} from "~/server/documents/data/documents_table.js";
import {
    getChannel,
    getChannelPreview,
    getPost,
    getPostComment,
} from "~/server/forum/data/forum_table.js";
import {chunkSearchContent} from "~/server/search/index/internal/chunk_search_content.js";
import {CohereEnglishLightLanguageModel} from "~/server/search/index/internal/cohere_english_light_language_model.js";
import {LanguageModelBase} from "~/server/search/index/internal/language_model_base.js";
import {SearchEntityId} from "~/server/search/index/internal/search_entity_id.js";
import {
    SearchEntityIndexAccessPolicy,
    SearchEntityIndexDefaultGrantType,
} from "~/server/search/index/internal/search_entity_index_doc.js";
import {truncateTokens} from "~/server/search/index/internal/truncate_tokens.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {TaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {getTaskNotesContent} from "~/server/tasks/data/task_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {Context} from "~/shared/context/context.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentModel,
    DocumentPreviewModel,
    getDocumentContentTitle,
} from "~/shared/documents/document_model.js";
import {NotFoundError, UnimplementedError} from "~/shared/error/error.js";
import {ChannelModel, ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
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
import {getMessageVersion} from "~/shared/messaging/message_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

// NOCOMMIT: Small messages like "Nice!" shouldn't be embedded at all?

type SearchEntity = {
    readonly id: SearchEntityId;
    readonly version: number | bigint | ReadonlyArray<number | bigint>;
    readonly accessPolicy: SearchEntityIndexAccessPolicy;
    readonly title: string | null;
    readonly body: string | null;
    readonly embeddingChunks: ReadonlyArray<{
        readonly preambleEndIndex: number;
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

    private readonly _accountDependencyById = new Map<
        AccountId | ContentMentionAccountId,
        Promise<AccountModel | null>
    >();
    private readonly _documentDependencyById = new Map<
        DocumentId,
        | {granularity: "Preview"; promise: Promise<DocumentPreviewModel>}
        | {granularity: "Full"; promise: Promise<DocumentModel>}
    >();
    private readonly _documentCommentDependencyById = new Map<
        `${DocumentId}:${DocumentCommentThreadId}:${number}`,
        Promise<DocumentCommentModel>
    >();
    private readonly _channelDependencyById = new Map<
        ChannelId,
        | {granularity: "Preview"; promise: Promise<ChannelPreviewModel>}
        | {granularity: "Full"; promise: Promise<ChannelModel>}
    >();
    private readonly _postDependencyById = new Map<PostId, Promise<PostModel>>();
    private readonly _postCommentDependencyById = new Map<
        `${PostId}:${number}`,
        Promise<PostCommentModel>
    >();
    private readonly _chatDependencyById = new Map<ChatId, Promise<ChatModel>>();
    private readonly _chatMessageDependencyById = new Map<
        `${ChatId}:${number}`,
        Promise<ChatMessageModel>
    >();
    private readonly _taskDependencyById = new Map<
        TaskId,
        | {
              granularity: "Authorization";
              promise: Promise<{
                  task: TaskModel;
                  referencedTaskById: ReadonlyMap<TaskId, TaskModel>;
                  referencedCollectionById: ReadonlyMap<TaskCollectionId, TaskCollectionModel>;
              }>;
          }
        | {
              granularity: "Full";
              promise: Promise<{
                  task: TaskModel;
                  referencedTaskById: ReadonlyMap<TaskId, TaskModel>;
                  referencedCollectionById: ReadonlyMap<TaskCollectionId, TaskCollectionModel>;
                  notesContent: {version: number; content: TaskNotesContentWithReferences};
              }>;
          }
    >();
    private readonly _taskCollectionDependencyById = new Map<
        TaskCollectionId,
        {
            granularity: "Authorization" | "Full";
            promise: Promise<TaskCollectionModel>;
        }
    >();

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
        return getOrSetDefaultMapValue(this._accountDependencyById, accountId, () =>
            getAccountIfExists(this._context, this._context.actor.getSpaceId(), accountId),
        );
    };

    // NOCOMMIT: Document
    private async _incorporateAuthorDependency<
        Model extends {author: AccountModel; clone(model: {author: AccountModel}): Model},
    >(model: Model): Promise<Model> {
        const accountEntry = this._accountDependencyById.get(model.author.id);

        if (!accountEntry) {
            this._accountDependencyById.set(model.author.id, Promise.resolve(model.author));
            return model;
        } else {
            return model.clone({
                // Make sure we index the data we've recorded as a dependency instead of data
                // at a potentially newer/older version.
                author: assertExists(await accountEntry),
            });
        }
    }

    private async _incorporateChannelDependency<
        Model extends {
            channel: ChannelPreviewModel;
            clone(model: {channel: ChannelPreviewModel}): Model;
        },
    >(model: Model): Promise<Model> {
        const channelEntry = this._channelDependencyById.get(model.channel.id);

        if (!channelEntry) {
            this._channelDependencyById.set(model.channel.id, {
                granularity: "Preview",
                promise: Promise.resolve(model.channel),
            });
            return model;
        } else {
            return model.clone({
                // Make sure we index the data we've recorded as a dependency instead of data
                // at a potentially newer/older version.
                channel: await channelEntry.promise,
            });
        }
    }

    public async getAccount(accountId: AccountId): Promise<AccountModel> {
        const account = await this.getAccountIfExists(accountId);
        if (!account) throw new NotFoundError("Account not found");
        return account;
    }

    /**
     * Get the full document by the provided `DocumentId` and record a
     * dependency on the document.
     */
    public getDocument(documentId: DocumentId): Promise<DocumentModel> {
        let entry = this._documentDependencyById.get(documentId);

        if (!entry || entry.granularity !== "Full") {
            entry = {
                granularity: "Full",
                promise: getDocument(this._context, documentId),
            };
            this._documentDependencyById.set(documentId, entry);
        }

        return entry.promise;
    }

    /**
     * Get a preview of the document by the provided `DocumentId` and record a
     * dependency on the document preview. We won't update the entity if the
     * document content changes by the document preview stays the same.
     */
    public getDocumentPreview(
        documentId: DocumentId,
    ): Promise<DocumentPreviewModel> | Promise<DocumentModel> {
        return getOrSetDefaultMapValue(this._documentDependencyById, documentId, () => ({
            granularity: "Preview" as const,
            promise: getDocumentPreview(this._context, documentId),
        })).promise;
    }

    // NOCOMMIT: Document that author is also tracked as a dependency
    public getDocumentComment(
        documentId: DocumentId,
        commentThreadId: DocumentCommentThreadId,
        commentIndex: number,
    ): Promise<DocumentCommentModel> {
        return getOrSetDefaultMapValue(
            this._documentCommentDependencyById,
            `${documentId}:${commentThreadId}:${commentIndex}`,
            () =>
                getDocumentComment(this._context, {documentId, commentThreadId, commentIndex}).then(
                    comment => this._incorporateAuthorDependency(comment),
                ),
        );
    }

    public getChannel(channelId: ChannelId): Promise<ChannelModel> {
        let entry = this._channelDependencyById.get(channelId);

        if (!entry || entry.granularity !== "Full") {
            entry = {
                granularity: "Full",
                promise: getChannel(this._context, channelId),
            };
            this._channelDependencyById.set(channelId, entry);
        }

        return entry.promise;
    }

    public getChannelPreview(
        channelId: ChannelId,
    ): Promise<ChannelPreviewModel> | Promise<ChannelModel> {
        return getOrSetDefaultMapValue(this._channelDependencyById, channelId, () => ({
            granularity: "Preview" as const,
            promise: getChannelPreview(this._context, channelId),
        })).promise;
    }

    // NOCOMMIT: Document that author and channel are also tracked as dependencies
    public getPost(postId: PostId): Promise<PostModel> {
        return getOrSetDefaultMapValue(this._postDependencyById, postId, () =>
            getPost(this._context, postId)
                .then(post => this._incorporateAuthorDependency(post))
                .then(post => this._incorporateChannelDependency(post)),
        );
    }

    // NOCOMMIT: Document that author is also tracked as a dependency
    public getPostComment(postId: PostId, commentIndex: number): Promise<PostCommentModel> {
        return getOrSetDefaultMapValue(
            this._postCommentDependencyById,
            `${postId}:${commentIndex}`,
            () =>
                getPostComment(this._context, {postId, commentIndex}).then(comment =>
                    this._incorporateAuthorDependency(comment),
                ),
        );
    }

    // NOCOMMIT: Document that accounts are also tracked as dependencies
    public getChat(chatId: ChatId): Promise<ChatModel> {
        return getOrSetDefaultMapValue(this._chatDependencyById, chatId, () =>
            getChat(this._context, chatId).then(async chat => {
                const accounts = await runAllPromises(
                    chat.accounts.map(async account => {
                        const accountEntry = this._accountDependencyById.get(account.id);

                        if (!accountEntry) {
                            this._accountDependencyById.set(account.id, Promise.resolve(account));
                            return account;
                        } else {
                            // Make sure we index the data we've recorded as a dependency instead of data
                            // at a potentially newer/older version.
                            return assertExists(await accountEntry);
                        }
                    }),
                );

                return chat.clone({accounts});
            }),
        );
    }

    public getChatMessage(chatId: ChatId, messageIndex: number): Promise<ChatMessageModel> {
        return getOrSetDefaultMapValue(
            this._chatMessageDependencyById,
            `${chatId}:${messageIndex}`,
            () =>
                getChatMessage(this._context, {chatId, messageIndex}).then(message =>
                    this._incorporateAuthorDependency(message),
                ),
        );
    }

    public getTask(taskId: TaskId): Promise<{
        task: TaskModel;
        referencedTaskById: ReadonlyMap<TaskId, TaskModel>;
        referencedCollectionById: ReadonlyMap<TaskCollectionId, TaskCollectionModel>;
        notesContent: {
            version: number;
            content: TaskNotesContentWithReferences;
        };
    }> {
        let entry = this._taskDependencyById.get(taskId);

        if (entry) {
            // If we previously loaded a task with `Authorization` dependency granularity
            // then treat it as a full dependency now. We need to load notes content fresh.
            if (entry.granularity !== "Full") {
                entry = {
                    granularity: "Full",
                    promise: runAllPromises([
                        entry.promise,
                        getTaskNotesContent(this._context, taskId),
                    ]).then(
                        ([{task, referencedTaskById, referencedCollectionById}, notesContent]) => ({
                            task,
                            referencedTaskById,
                            referencedCollectionById,
                            notesContent,
                        }),
                    ),
                };
                this._taskDependencyById.set(taskId, entry);
            }
        } else {
            entry = {
                granularity: "Full",
                promise: runAllPromises([
                    this._context.tasks.getTask(this._context.actor.getSpaceId(), taskId),
                    getTaskNotesContent(this._context, taskId),
                ]).then(async ([{task, referencedTasks, referencedCollections}, notesContent]) => {
                    const referencedTaskById = new Map<TaskId, TaskModel>();
                    const referencedCollectionById = new Map<
                        TaskCollectionId,
                        TaskCollectionModel
                    >();

                    // Make sure we track authorization dependencies on all referenced tasks and
                    // referenced collections...
                    await runAllPromises([
                        runAllPromises(
                            referencedTasks.map(async referencedTask => {
                                const referencedTaskEntry = this._taskDependencyById.get(
                                    referencedTask.id,
                                );

                                if (referencedTaskEntry) {
                                    // If a dependency for a referenced task already exists, we should return the
                                    // same data as what we previously loaded so search indexing is consistent
                                    // (like we do for other methods in this class). We don't implement this for
                                    // now since we only expect one `getTask()` call per indexer class.
                                    throw new UnimplementedError(
                                        "Didn't expect dependency for referenced task to already exist",
                                    );
                                } else {
                                    this._taskDependencyById.set(referencedTask.id, {
                                        granularity: "Authorization",
                                        promise: Promise.resolve({
                                            task: referencedTask,
                                            referencedTaskById,
                                            referencedCollectionById,
                                        }),
                                    });

                                    referencedTaskById.set(referencedTask.id, referencedTask);
                                }
                            }),
                        ),
                        runAllPromises(
                            referencedCollections.map(async referencedCollection => {
                                const referencedCollectionEntry =
                                    this._taskCollectionDependencyById.get(referencedCollection.id);

                                if (referencedCollectionEntry) {
                                    // If a dependency for a referenced task already exists, we should return the
                                    // same data as what we previously loaded so search indexing is consistent
                                    // (like we do for other methods in this class). We don't implement this for
                                    // now since we only expect one `getTask()` call per indexer class.
                                    throw new UnimplementedError(
                                        "Didn't expect dependency for referenced collection to already exist",
                                    );
                                } else {
                                    this._taskCollectionDependencyById.set(
                                        referencedCollection.id,
                                        {
                                            granularity: "Authorization",
                                            promise: Promise.resolve(referencedCollection),
                                        },
                                    );

                                    referencedCollectionById.set(
                                        referencedCollection.id,
                                        referencedCollection,
                                    );
                                }
                            }),
                        ),
                    ]);

                    return {
                        task,
                        referencedTaskById,
                        referencedCollectionById,
                        notesContent,
                    };
                }),
            };
            this._taskDependencyById.set(taskId, entry);
        }

        return entry.promise;
    }

    public getTaskCollection(collectionId: TaskCollectionId): Promise<TaskCollectionModel> {
        let entry = this._taskCollectionDependencyById.get(collectionId);

        if (entry) {
            // If we previously loaded a task with `Authorization` dependency granularity
            // then treat it as a full dependency now.
            entry.granularity = "Full";
        } else {
            entry = {
                granularity: "Full",
                promise: this._context.tasks
                    .getCollection(this._context.actor.getSpaceId(), collectionId)
                    .then(({collection}) => collection),
            };
            this._taskCollectionDependencyById.set(collectionId, entry);
        }

        return entry.promise;
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
        version: account.initialData.version,

        // Anyone in a space can see all the accounts in a space.
        accessPolicy: {
            accountGrantAccountIds: [],
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
    const document = await indexer.getDocument(documentId);

    const {getFullText, embeddingChunks} = await chunkDocumentSearchContent(
        document.content.doc,
        indexer,
    );

    return {
        id: `Document:${documentId}`,

        version: document.version,

        // TODO(calebmer): Documents are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: [],
            defaultGrantType: "Space",
        },

        title: document.getTitle(),
        body: getFullText(),
        embeddingChunks,
    };
}

export function chunkDocumentSearchContent(
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

    return chunkSearchContent(contentWithoutTitle, {
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
}

async function indexDocumentCommentSearchEntity(
    indexer: SearchEntityIndexer,
    documentId: DocumentId,
    commentThreadId: DocumentCommentThreadId,
    commentIndex: number,
): Promise<SearchEntity> {
    const [documentPreview, comment] = await runAllPromises([
        indexer.getDocumentPreview(documentId),
        indexer.getDocumentComment(documentId, commentThreadId, commentIndex),
    ]);

    const authorShortName = getAccountShortNameWithoutFullNameTooltip(comment.author.initialData);

    const truncatedTitle = new Lazy(() =>
        truncateTokens(
            indexer.model,
            documentPreview.getTitle(),
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const content =
        comment.payload.type === "Content"
            ? await chunkSearchContent(comment.payload.content.doc, {
                  model: indexer.model,
                  getAccountIfExists: indexer.getAccountIfExists,
                  getChunkPreamble: ({isInitialChunk}) => {
                      return {
                          text: `This is${
                              isInitialChunk ? " a " : " from a "
                          }comment by ${authorShortName} on the “${truncatedTitle.get()}” document:`,
                          lineMarginBottom: 2,
                      };
                  },
              })
            : null;

    return {
        id: `DocumentComment:${documentId}:${commentThreadId}:${commentIndex}`,

        version: getMessageVersion(comment),

        // TODO(calebmer): Documents are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: [],
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
    const channel = await indexer.getChannel(channelId);

    const truncatedName = new Lazy(() =>
        truncateTokens(indexer.model, channel.name, searchEntityEmbeddingPreambleTitleTokenCount),
    );

    const {getFullText, embeddingChunks} = await chunkSearchContent(channel.description.doc, {
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

        version: channel.version,

        // TODO(calebmer): Channels are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: [],
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
    const post = await indexer.getPost(postId);

    const authorShortName = getAccountShortNameWithoutFullNameTooltip(post.author.initialData);

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

    const {getFullText, embeddingChunks} = await chunkSearchContent(post.content.doc, {
        model: indexer.model,
        getAccountIfExists: indexer.getAccountIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            return {
                text: `This is${isInitialChunk ? " a " : " from a "}post by ${authorShortName}${
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

        version: post.getVersion(),

        // TODO(calebmer): Channels are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: [],
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
    const [post, comment] = await runAllPromises([
        indexer.getPost(postId),
        indexer.getPostComment(postId, commentIndex),
    ]);

    const postAuthorShortName = getAccountShortNameWithoutFullNameTooltip(post.author.initialData);
    const authorShortName = getAccountShortNameWithoutFullNameTooltip(comment.author.initialData);

    const truncatedChannelTitle = new Lazy(() =>
        truncateTokens(
            indexer.model,
            post.channel.name,
            searchEntityEmbeddingPreambleTitleTokenCount,
        ),
    );

    const content =
        comment.payload.type === "Content"
            ? await chunkSearchContent(comment.payload.content.doc, {
                  model: indexer.model,
                  getAccountIfExists: indexer.getAccountIfExists,
                  getChunkPreamble: ({isInitialChunk}) => {
                      return {
                          text: `This is${
                              isInitialChunk ? " a " : " from a "
                          }comment by ${authorShortName} on a post by ${postAuthorShortName} in the “${truncatedChannelTitle.get()}” channel:`,
                          lineMarginBottom: 2,
                      };
                  },
              })
            : null;

    return {
        id: `PostComment:${postId}:${commentIndex}`,

        version: getMessageVersion(comment),

        // TODO(calebmer): Documents are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: [],
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
    const chat = await indexer.getChat(chatId);

    const accountNames = chat.accounts.map(account => account.initialData.name);

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

        // TODO(calebmer): Chats currently can't be updated. Eventually I think we'll
        // add chats that you can add account members to. At that point we'll need this
        // version number to increment.
        version: [],

        accessPolicy: {
            accountGrantAccountIds: chat.accounts.map(account => account.id),
            defaultGrantType: null,
        },

        title,
        body: null,
        embeddingChunks: [],
    };
}

async function indexChatMessageSearchEntity(
    indexer: SearchEntityIndexer,
    chatId: ChatId,
    messageIndex: number,
): Promise<SearchEntity> {
    const [chat, message] = await runAllPromises([
        indexer.getChat(chatId),
        indexer.getChatMessage(chatId, messageIndex),
    ]);

    const authorShortName = getAccountShortNameWithoutFullNameTooltip(message.author.initialData);

    const accountShortNames = chat.accounts.map(account =>
        getAccountShortNameWithoutFullNameTooltip(account.initialData),
    );

    let accountsSummary: string;
    if (accountShortNames.length === 0) {
        accountsSummary = "";
    } else if (accountShortNames.length === 1) {
        accountsSummary = accountShortNames[0]!;
    } else if (accountShortNames.length === 2) {
        accountsSummary = `${accountShortNames[0]!} and ${accountShortNames[1]!}`;
    } else if (accountShortNames.length <= 10) {
        accountsSummary = `${accountShortNames
            .slice(0, accountShortNames.length - 1)
            .join(", ")}, and ${accountShortNames[accountShortNames.length - 1]!}`;
    } else {
        const otherCount = accountShortNames.length - 10;

        accountsSummary = `${accountShortNames.slice(0, 10).join(", ")}, and ${otherCount} other${
            otherCount > 0 ? "s" : ""
        }`;
    }

    const content =
        message.payload.type === "Content"
            ? await chunkSearchContent(message.payload.content.doc, {
                  model: indexer.model,
                  getAccountIfExists: indexer.getAccountIfExists,
                  getChunkPreamble: ({isInitialChunk}) => {
                      return {
                          text: `This is${
                              isInitialChunk ? " a " : " from a "
                          }message by ${authorShortName} in a chat${
                              chat.accounts.length === 1 &&
                              chat.accounts[0]!.id === message.author.id
                                  ? " with themselves"
                                  : ` between ${accountsSummary}`
                          }:`,
                          lineMarginBottom: 2,
                      };
                  },
              })
            : null;

    return {
        id: `ChatMessage:${chatId}:${messageIndex}`,

        version: getMessageVersion(message),

        accessPolicy: {
            accountGrantAccountIds: chat.accounts.map(account => account.id),
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

        // NOCOMMIT: Versioning doesn't work for tasks! Need a different mechanism...
        version: 0,

        accessPolicy: {
            accountGrantAccountIds: Array.from(accountGrantAccountIds),
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
    let accountGrantAccountIds = Array.from(accessPolicy.accountGrantById.keys());

    // If we have a space default grant then the individual account grants don't
    // matter for the search entity. Lets exclude them to save space in the index.
    if (defaultGrantType !== null) {
        cast<"Space">(defaultGrantType);
        accountGrantAccountIds = [];
    }

    return {
        id: `TaskCollection:${collectionId}`,

        // NOCOMMIT: Versioning doesn't work for tasks! Need a different mechanism...
        version: 0,

        accessPolicy: {
            accountGrantAccountIds: Array.from(accountGrantAccountIds),
            defaultGrantType,
        },

        title: collection.getName(),
        body: null,
        embeddingChunks: [],
    };
}
