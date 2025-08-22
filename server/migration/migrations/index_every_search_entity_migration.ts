import {expensiveScanEveryChatAndChatMessageForMigration} from "~/server/chat/data/chat_actions.js";
import {expensiveScanEveryDocumentAndDocumentCommentForMigration} from "~/server/documents/data/documents_table.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {
    expensiveScanEveryChannelAndPostForMigration,
    expensiveScanEveryPostCommentForMigration,
} from "~/server/forum/data/forum_table.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {expensiveScanEverySpaceAccountForMigration} from "~/server/spaces/spaces_table.js";
import {expensiveScanEveryTaskAndTaskCollectionForMigration} from "~/server/tasks/data/task_table.js";
import {Context} from "~/shared/context/context.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

const subSegmentCount = 3;
const countLogInterval = process.env.NODE_ENV !== "production" ? 100 : 1000;

/**
 * Scan our database for all content that can be indexed in the search system
 * and submit jobs to index that content. This will make all content available
 * for search. May also be useful if you make a change to search indexing and
 * need to re-index all content from the source.
 */
export function runIndexEverySearchEntityMigration(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {segmentIndex: number; totalSegmentCount: number},
) {
    return runIndexSearchEntityMigrationModules(context, allMigrationModules, options);
}

/**
 * Just index post and channel search entities. Same as
 * `runIndexEverySearchEntityMigration()` but with only those search entity
 * types.
 */
export function runIndexPostAndChannelSearchEntitiesMigration(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {segmentIndex: number; totalSegmentCount: number},
) {
    return runIndexSearchEntityMigrationModules(
        context,
        [channelAndPostSearchEntityMigrationModule],
        options,
    );
}

/**
 * Just index task and task collection search entities. Same as
 * `runIndexEverySearchEntityMigration()` but with only those search entity
 * types.
 */
export function runIndexTaskAndTaskCollectionSearchEntitiesMigration(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {segmentIndex: number; totalSegmentCount: number},
) {
    return runIndexSearchEntityMigrationModules(
        context,
        [taskAndTaskCollectionSearchEntityMigrationModule],
        options,
    );
}

type MigrationModule = (
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    options: {segmentIndex: number; totalSegmentCount: number},
) => Promise<void>;

async function runIndexSearchEntityMigrationModules(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    modules: Array<MigrationModule>,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
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
        context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
        item: Item,
    ) => MaybePromise<void>,
): MigrationModule {
    return async (context, options) => {
        // We use a linked span instead of a child span since it's not practical to
        // read a span with thousands of children.
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
                    const maybePromise = processItem(context, item);
                    if (maybePromise instanceof Promise) await maybePromise;

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
    async (context, item) => {
        switch (item.type) {
            case "Channel": {
                context.jobs.send({
                    type: "IndexSearchEntity",
                    spaceId: item.spaceId,
                    update: {
                        type: "Channel",
                        channelId: item.channelId,
                        updatedTraits: {type: "None"},
                    },
                });
                break;
            }
            case "Post": {
                context.jobs.send({
                    type: "IndexSearchEntity",
                    spaceId: item.spaceId,
                    update: {
                        type: "Post",
                        postId: item.postId,
                        updatedTraits: {type: "None"},
                    },
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
    async (context, item) => {
        switch (item.type) {
            case "Task": {
                context.jobs.send({
                    type: "IndexSearchEntity",
                    spaceId: item.spaceId,
                    update: {
                        type: "Task",
                        taskId: item.taskId,
                        updatedTraits: {type: "None"},
                    },
                });
                break;
            }
            case "TaskCollection": {
                context.jobs.send({
                    type: "IndexSearchEntity",
                    spaceId: item.spaceId,
                    update: {
                        type: "TaskCollection",
                        collectionId: item.collectionId,
                        updatedTraits: {type: "None"},
                    },
                });
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
        (context, {spaceId, accountId}) => {
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId,
                update: {
                    type: "Account",
                    accountId,
                    updatedTraits: {type: "None"},
                },
            });
        },
    ),
    createDynamoScanMigrationModule(
        "documents and document comments",
        expensiveScanEveryDocumentAndDocumentCommentForMigration,
        async (context, item) => {
            switch (item.type) {
                case "Document": {
                    context.jobs.send({
                        type: "IndexSearchEntity",
                        spaceId: item.spaceId,
                        update: {
                            type: "Document",
                            documentId: item.documentId,
                            updatedTraits: {type: "None"},
                        },
                    });
                    break;
                }
                case "DocumentComment": {
                    context.jobs.send({
                        type: "IndexSearchEntity",
                        spaceId: await item.getSpaceId(),
                        update: {
                            type: "DocumentComment",
                            documentId: item.documentId,
                            commentThreadId: item.commentThreadId,
                            commentIndex: item.commentIndex,
                            updatedTraits: {type: "None"},
                        },
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
        async (context, item) => {
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId: await item.getSpaceId(),
                update: {
                    type: "PostComment",
                    postId: item.postId,
                    commentIndex: item.commentIndex,
                    updatedTraits: {type: "None"},
                },
            });
        },
    ),
    createDynamoScanMigrationModule(
        "chats and chat messages",
        expensiveScanEveryChatAndChatMessageForMigration,
        async (context, item) => {
            switch (item.type) {
                case "Chat": {
                    context.jobs.send({
                        type: "IndexSearchEntity",
                        spaceId: item.spaceId,
                        update: {
                            type: "Chat",
                            chatId: item.chatId,
                            updatedTraits: {type: "None"},
                        },
                    });
                    break;
                }
                case "ChatMessage": {
                    context.jobs.send({
                        type: "IndexSearchEntity",
                        spaceId: await item.getSpaceId(),
                        update: {
                            type: "ChatMessage",
                            chatId: item.chatId,
                            messageIndex: item.messageIndex,
                            updatedTraits: {type: "None"},
                        },
                    });
                    break;
                }
                default:
                    throw exhaustive(item);
            }
        },
    ),
    taskAndTaskCollectionSearchEntityMigrationModule,
];
