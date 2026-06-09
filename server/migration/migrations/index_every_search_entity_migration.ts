import {expensiveScanEveryChatAndChatMessageForMigration} from "~/server/chat/data/expensive_scan_every_chat_and_chat_message_for_migration.js";
import {expensiveScanEveryDocumentAndDocumentCommentForMigration} from "~/server/documents/data/documents_actions.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {expensiveScanEveryChannelAndPostForMigration} from "~/server/forum/data/expensive_scan_every_channel_and_post_for_migration.js";
import {expensiveScanEveryPostCommentForMigration} from "~/server/forum/data/expensive_scan_every_post_comment_for_migration.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {scheduleIndexSearchEntityEmbeddingChunksJob} from "~/server/search/data/table/search_entity_actions.js";
import {expensiveScanEverySpaceAccountForMigration} from "~/server/spaces/expensive_scan_every_space_account_for_migration.js";
import {expensiveScanEveryTaskAndTaskCollectionForMigration} from "~/server/tasks/data/migrations/expensive_scan_every_task_and_task_collection_for_migration.js";
import {Context} from "~/shared/context/context.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    SearchDynamicEntityIdObject,
    printSearchDynamicEntityId,
} from "~/shared/search/search_entity_id.js";

const subSegmentCount = 3;
const countLogInterval = process.env.NODE_ENV !== "production" ? 100 : 1000;

/**
 * Scan our database for all content that can be indexed in the search system and
 * submit jobs to index that content. This will make all content available for
 * search. May also be useful if you make a change to search indexing and need to
 * re-index all content from the source.
 */
export function runIndexEverySearchEntityMigration(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {segmentIndex: number; totalSegmentCount: number},
) {
    return runIndexSearchEntityMigrationModules(context, allMigrationModules, {
        ...options,
        send: sendIndexSearchEntityJob,
    });
}

/**
 * Just index post and channel search entities. Same as
 * `runIndexEverySearchEntityMigration()` but with only those search entity types.
 */
export function runIndexPostAndChannelSearchEntitiesMigration(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {segmentIndex: number; totalSegmentCount: number},
) {
    return runIndexSearchEntityMigrationModules(
        context,
        [channelAndPostSearchEntityMigrationModule],
        {...options, send: sendIndexSearchEntityJob},
    );
}

/**
 * Just index chat and chat message search entities. Same as
 * `runIndexEverySearchEntityMigration()` but with only those search entity types.
 */
export function runIndexChatAndChatMessageSearchEntitiesMigration(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {segmentIndex: number; totalSegmentCount: number},
) {
    return runIndexSearchEntityMigrationModules(
        context,
        [chatAndChatMessageSearchEntityMigrationModule],
        {...options, send: sendIndexSearchEntityJob},
    );
}

/**
 * Just index task and task collection search entities. Same as
 * `runIndexEverySearchEntityMigration()` but with only those search entity types.
 */
export function runIndexTaskAndTaskCollectionSearchEntitiesMigration(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {segmentIndex: number; totalSegmentCount: number},
) {
    return runIndexSearchEntityMigrationModules(
        context,
        [taskAndTaskCollectionSearchEntityMigrationModule],
        {...options, send: sendIndexSearchEntityJob},
    );
}

async function sendIndexSearchEntityJob(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    spaceId: SpaceId,
    entityIdObject: SearchDynamicEntityIdObject,
) {
    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {...entityIdObject, updatedTraits: {type: "None"}},
    });
}

/**
 * Run the `IndexSearchEntityEmbeddingChunksJob` job with
 * `forceMetadataUpdate: true` for every search entity. Scans over our DynamoDB
 * tables to find all entities and schedules a job for each one.
 *
 * Introduced when we had a security issue where `accessPolicy` in embedding chunks
 * wasn't being updated properly.
 */
export function runIndexEverySearchEntityEmbeddingChunksForceMetadataUpdate(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {segmentIndex: number; totalSegmentCount: number},
) {
    return runIndexSearchEntityMigrationModules(context, allMigrationModules, {
        ...options,
        send: async (context, spaceId, entityIdObject) => {
            await scheduleIndexSearchEntityEmbeddingChunksJob(context, {
                spaceId,
                entityId: printSearchDynamicEntityId(entityIdObject),
                readAfterTime: new Date(),
                forceMetadataUpdate: true,
            });
        },
    });
}

type MigrationModule = (
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {
        segmentIndex: number;
        totalSegmentCount: number;
        send: (
            context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
            spaceId: SpaceId,
            entityIdObject: SearchDynamicEntityIdObject,
        ) => Promise<void>;
    },
) => Promise<void>;

async function runIndexSearchEntityMigrationModules(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    modules: Array<MigrationModule>,
    {
        segmentIndex,
        totalSegmentCount,
        send,
    }: {
        segmentIndex: number;
        totalSegmentCount: number;
        send: (
            context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
            spaceId: SpaceId,
            entityIdObject: SearchDynamicEntityIdObject,
        ) => Promise<void>;
    },
) {
    const promiseWaiter = new PromiseWaiter();
    const mutexes = createArrayWithLength(subSegmentCount, () => new Mutex());

    const errors: Array<unknown> = [];

    let n = 0;
    for (let i = 0; i < subSegmentCount; i++) {
        for (const migrationModule of modules) {
            const mutex = mutexes[n++ % mutexes.length]!;

            const subSegmentIndex = segmentIndex * subSegmentCount + i;
            const totalSubSegmentCount = totalSegmentCount * subSegmentCount;

            promiseWaiter.waitUntil(
                mutex.withLock(async () => {
                    try {
                        await migrationModule(context, {
                            segmentIndex: subSegmentIndex,
                            totalSegmentCount: totalSubSegmentCount,
                            send,
                        });
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.error("Migration module failed:", error);
                        errors.push(error);
                    }
                }),
            );
        }
    }

    await promiseWaiter.wait();

    if (errors.length > 0) throw createAggregateError(errors);
}

function createDynamoScanMigrationModule<Item>(
    description: string,
    scan: (
        context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
        options: {segmentIndex: number; totalSegmentCount: number},
    ) => AsyncIterable<Item>,
    processItem: (
        item: Item,
        send: (spaceId: SpaceId, entityIdObject: SearchDynamicEntityIdObject) => Promise<void>,
    ) => Promise<void>,
): MigrationModule {
    return async (context, options) => {
        // We use a linked span instead of a child span since it's not practical to read a
        // span with thousands of children.
        await context.tracer.withSpanAsLinked(
            `Index all ${description} for search`,
            async (context, span) => {
                span.addData({
                    migration: {
                        segmentIndex: options.segmentIndex,
                        totalSegmentCount: options.totalSegmentCount,
                    },
                });

                let count = 0;

                for await (const item of scan(context, options)) {
                    await processItem(item, (spaceId, entityIdObject) =>
                        options.send(context, spaceId, entityIdObject),
                    );

                    if (count !== 0 && count % countLogInterval === 0) {
                        // eslint-disable-next-line no-console
                        console.log(
                            `Scanned ${count} ${description} (segment ${options.segmentIndex + 1}/${
                                options.totalSegmentCount
                            })`,
                        );
                    }

                    count += 1;
                }

                // eslint-disable-next-line no-console
                console.log(
                    `Finished scanning ${count} ${description} (segment ${
                        options.segmentIndex + 1
                    }/${options.totalSegmentCount})`,
                );
            },
        );
    };
}

const channelAndPostSearchEntityMigrationModule = createDynamoScanMigrationModule(
    "channels and posts",
    expensiveScanEveryChannelAndPostForMigration,
    async (item, send) => {
        switch (item.type) {
            case "Channel": {
                await send(item.spaceId, {type: "Channel", channelId: item.channelId});
                break;
            }
            case "Post": {
                await send(item.spaceId, {type: "Post", postId: item.postId});
                break;
            }
            default:
                throw exhaustive(item);
        }
    },
);

const chatAndChatMessageSearchEntityMigrationModule = createDynamoScanMigrationModule(
    "chats and chat messages",
    expensiveScanEveryChatAndChatMessageForMigration,
    async (item, send) => {
        switch (item.type) {
            case "Chat": {
                await send(item.spaceId, {type: "Chat", chatId: item.chatId});
                break;
            }
            case "ChatMessage": {
                await send(await item.getSpaceId(), {
                    type: "ChatMessage",
                    chatId: item.chatId,
                    messageIndex: item.messageIndex,
                });
                break;
            }
            default:
                throw exhaustive(item);
        }
    },
);

const taskAndTaskCollectionSearchEntityMigrationModule = createDynamoScanMigrationModule(
    "tasks and task collections",
    expensiveScanEveryTaskAndTaskCollectionForMigration,
    async (item, send) => {
        switch (item.type) {
            case "Task": {
                await send(item.spaceId, {type: "Task", taskId: item.taskId});
                break;
            }
            case "TaskCollection": {
                await send(item.spaceId, {type: "TaskCollection", collectionId: item.collectionId});
                break;
            }
            default:
                throw exhaustive(item);
        }
    },
);

const allMigrationModules: Array<MigrationModule> = [
    createDynamoScanMigrationModule(
        "space accounts",
        expensiveScanEverySpaceAccountForMigration,
        async ({spaceId, accountId}, send) => {
            await send(spaceId, {type: "Account", accountId});
        },
    ),
    createDynamoScanMigrationModule(
        "documents and document comments",
        expensiveScanEveryDocumentAndDocumentCommentForMigration,
        async (item, send) => {
            switch (item.type) {
                case "Document": {
                    await send(item.spaceId, {type: "Document", documentId: item.documentId});
                    break;
                }
                case "DocumentComment": {
                    await send(await item.getSpaceId(), {
                        type: "DocumentComment",
                        documentId: item.documentId,
                        commentThreadId: item.commentThreadId,
                        commentIndex: item.commentIndex,
                    });
                    break;
                }
                default:
                    throw exhaustive(item);
            }
        },
    ),
    channelAndPostSearchEntityMigrationModule,
    createDynamoScanMigrationModule(
        "post comments",
        expensiveScanEveryPostCommentForMigration,
        async (item, send) => {
            await send(await item.getSpaceId(), {
                type: "PostComment",
                postId: item.postId,
                commentIndex: item.commentIndex,
            });
        },
    ),
    chatAndChatMessageSearchEntityMigrationModule,
    taskAndTaskCollectionSearchEntityMigrationModule,
];
