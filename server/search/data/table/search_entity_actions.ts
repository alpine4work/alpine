import {
    ServerActionContext,
    ServerImpersonatedAccountActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {
    ActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/server/helpers/node/is_test_node_env_or_admin_scenarios_script.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    AccountSearchAffinityEntitiesIndex,
    AccountSearchFavoriteEntitiesIndex,
    SearchEntityTable,
    SpaceChannelSearchAffinityEntitiesIndex,
    SpaceTaskCollectionSearchAffinityEntitiesIndex,
} from "~/server/search/data/table/internal/search_entity_table.js";
import {
    authorizeNotBotSpaceAccount,
    authorizeOwnSpaceAccountAccess,
    authorizeSpaceAccess,
    expensiveScanEverySpaceAccountForMigration,
    isAccountMemberOfSpaceWithoutAuthorization,
    isBotSpaceAccount,
} from "~/server/spaces/spaces_actions.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ErrorBase, InvalidArgumentError, UnavailableError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {createInterval} from "~/shared/helpers/async/interval.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    defaultUncertaintyWindowMs,
    isDateDefinitelyLessThanWithUncertaintyWindow,
    isDatePossiblyLessThanWithUncertaintyWindow,
} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {filterAsyncIterableIterator} from "~/shared/helpers/iterable/filter_async_iterable_iterator.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {
    OrderKey,
    generateOrderKeyBetween,
    initialOrderKey,
} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {Id, assertId, generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    DocumentId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {SearchAffinityEntityInteraction} from "~/shared/search/search_affinity_entity_interaction.js";
import {SearchAffinityEntityId, SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";

/**
 * The refresh interval of our search entity keywords index. Since we
 * use OpenSearch serverless we must use the constant refresh interval they
 * provide.
 *
 * > The refresh interval for indexes in vector search collections is
 * > approximately 60 seconds. The refresh interval for indexes in search and
 * > time series collections is approximately 10 seconds.
 *
 * ([Source][1])
 *
 * [1]: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-overview.html
 */
export const searchEntityKeywordIndexRefreshIntervalMs = 10 * 1000;

/**
 * The refresh interval of our search entity embedding chunk index. Since we
 * use OpenSearch serverless we must use the constant refresh interval they
 * provide.
 *
 * > The refresh interval for indexes in vector search collections is
 * > approximately 60 seconds. The refresh interval for indexes in search and
 * > time series collections is approximately 10 seconds.
 *
 * ([Source][1])
 *
 * [1]: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-overview.html
 */
export const searchEntityEmbeddingChunkIndexRefreshIntervalMs = 60 * 1000;

/**
 * Since we don't have a way to reliably wait for the search index to refresh
 * we wait _three times_ the refresh interval. This should be enough to cover
 * any variance in refresh interval time.
 *
 * Ideally AWS OpenSearch serverless would provide us a `/_wait_for_refresh`
 * endpoint that gives us reliable read-after-write consistency.
 */
export const searchEntityKeywordIndexWaitForRefreshDelayMs =
    searchEntityKeywordIndexRefreshIntervalMs * 3;

/**
 * Since we don't have a way to reliably wait for the search index to refresh
 * we wait _three times_ the refresh interval. This should be enough to cover
 * any variance in refresh interval time.
 *
 * Ideally AWS OpenSearch serverless would provide us a `/_wait_for_refresh`
 * endpoint that gives us reliable read-after-write consistency.
 */
const searchEntityEmbeddingChunkIndexWaitForRefreshDelayMs =
    searchEntityEmbeddingChunkIndexRefreshIntervalMs * 3;

type SearchAffinityEntityItem = DynamoTableItemType<
    typeof SearchEntityTable,
    "Account",
    "SearchEntityAffinity"
>;

/**
 * Add the "My tasks" view to the favorites of every space account. This was
 * run on 2025-04-01 right after making it so that we always add "My tasks" to
 * the favorites list of new accounts. The migration backfills the "My tasks"
 * favorite to all existing space accounts.
 */
export async function runFavoriteTaskPersonalSearchEntityMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    let i = 0;
    const promiseWaiter = new PromiseWaiter();
    const mutexes = createArrayWithLength(10, () => new Mutex());

    for await (const {spaceId, accountId} of expensiveScanEverySpaceAccountForMigration(context, {
        segmentIndex,
        totalSegmentCount,
    })) {
        promiseWaiter.waitUntil(
            mutexes[i++ % mutexes.length]!.withLock(() =>
                dangerouslyFavoriteSearchEntityWithoutAuthorization(context, {
                    spaceId,
                    accountId,
                    entityId: "TaskPersonal",
                }),
            ),
        );
    }

    await promiseWaiter.wait();
}

/**
 * Schedule a `IndexSearchEntityEmbeddingChunks` job.
 * `IndexSearchEntityEmbeddingChunks` jobs are throttled (as of 2025-04-11
 * they're throttled to once every 5min) so:
 *
 * - New jobs are scheduled with some delay.
 * - If there's a job scheduled in the future that will read the entity after
 *   `readAfterTime` we won't schedule a new job.
 *
 * You must call this function to schedule a
 * `IndexSearchEntityEmbeddingChunksJob` job. Since when the job runs it needs
 * an exclusive lock. The state for that exclusive lock is set up here.
 */
export async function scheduleIndexSearchEntityEmbeddingChunksJob(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    {
        spaceId,
        entityId,
        readAfterTime,
    }: {
        spaceId: SpaceId;
        entityId: SearchDynamicEntityId;
        readAfterTime: Date;
    },
) {
    const jobId = generateId();

    const item = await SearchEntityTable.updateItem(
        context,
        {
            partitionType: "IndexSearchEntityEmbeddingChunksJob",
            sortRangeType: "State",
            spaceId,
            entityId,
        },
        item => {
            // Our previous job already read the entity update we're targeting. So we
            // don't need to schedule another job.
            if (
                item?.previousJob &&
                isDateDefinitelyLessThanWithUncertaintyWindow(
                    readAfterTime,
                    item.previousJob.startTime,
                )
            ) {
                return item;
            }

            // A scheduled job will read the entity update we're targeting. So we
            // don't need to schedule another job.
            if (
                item?.scheduledJobs.some(scheduledJob =>
                    isDateDefinitelyLessThanWithUncertaintyWindow(
                        readAfterTime,
                        scheduledJob.startTime,
                    ),
                )
            ) {
                return item;
            }

            // The active job is currently reading the entity update we're targeting. So we
            // don't need to schedule another job.
            if (
                item?.activeJob &&
                isDateDefinitelyLessThanWithUncertaintyWindow(
                    readAfterTime,
                    item.activeJob.startTime,
                )
            ) {
                return item;
            }

            const currentTime = new Date();

            // We want to throttle `IndexSearchEntityEmbeddingChunks` jobs. Since:
            //
            // 1. Embedding text with our LLM is expensive
            // 2. Updating the OpenSearch vector index is expensive
            //
            // So schedule our `IndexSearchEntityEmbeddingChunks` job for the future. The
            // specific amount of delay we add here is the throttle rate. It should be
            // greater than `searchEntityEmbeddingChunkIndexWaitForRefreshDelayMs`. Since we
            // have to wait at least that much time between job runs anyway since our job
            // needs to wait for OpenSearch to refresh because it uses `/_search` to read
            // data from the previous job.
            //
            // Currently `searchEntityEmbeddingChunkIndexWaitForRefreshDelayMs` is 3min and
            // we add 2min so our throttle rate is 5min.
            const scheduledJobStartTime = new Date(
                Math.max(
                    readAfterTime.getTime() +
                        searchEntityEmbeddingChunkIndexWaitForRefreshDelayMs +
                        2 * 60 * 1000,

                    // If `readAfterTime` is more than five minutes before the current time then
                    // schedule the job to run immediately.
                    currentTime.getTime(),
                ),
            );

            const scheduledJobStartDelayMs =
                scheduledJobStartTime.getTime() - currentTime.getTime();

            // The max SQS `delaySeconds` is 15min. Make sure we're not scheduling a job
            // for more than 15min from now.
            assert(0 <= scheduledJobStartDelayMs && scheduledJobStartDelayMs <= 15 * 60 * 1000);

            return {
                ...item,
                partitionType: "IndexSearchEntityEmbeddingChunksJob",
                sortRangeType: "State",
                spaceId,
                entityId,
                previousJob: item?.previousJob ?? null,
                activeJob: item?.activeJob ?? null,
                scheduledJobs: [
                    ...(item?.scheduledJobs ?? []),
                    {
                        id: jobId,
                        startTime: scheduledJobStartTime,
                    },
                ],
            };
        },
        // Make sure we didn't read data with an eventual consistency lag by making an
        // `updateLockVersion` condition check even for noop updates.
        {withNoopUpdateLockVersionConditionCheck: true},
    );

    const scheduledJob = item?.scheduledJobs.find(job => job.id === jobId);

    // We didn't schedule a new job.
    if (!scheduledJob) return;

    // Send the job immediately since the caller needs to wait for the job to be
    // sent before continuing. Particularly, `IndexSearchEntity` must wait for the
    // job to be sent before it can finish writing to the search index.
    await context.jobs.sendAndWait(
        {
            type: "IndexSearchEntityEmbeddingChunks",
            id: jobId,
            spaceId,
            entityId,
        },
        {
            delaySeconds: Math.max(
                Math.ceil((scheduledJob.startTime.getTime() - Date.now()) / 1000),

                // If `scheduledJob.startTime` is in the past then `delaySeconds` would be a
                // negative number which we can't allow.
                0,
            ),
        },
    );
}

export const withIndexSearchEntityEmbeddingChunksJobLockIntervalPromiseWaiterForTest = import.meta
    .jest
    ? new PromiseWaiter()
    : null;

const withIndexSearchEntityEmbeddingChunksJobLockSimulatedCrashErrorSymbol =
    Symbol("simulatedCrash");

function isWithIndexSearchEntityEmbeddingChunksJobLockSimulatedCrashErrorForTest(
    error: unknown,
): boolean {
    return (
        !!import.meta.jest &&
        isObject(error) &&
        !!error[withIndexSearchEntityEmbeddingChunksJobLockSimulatedCrashErrorSymbol]
    );
}

export function createWithIndexSearchEntityEmbeddingChunksJobLockSimulatedCrashErrorForTest(): ErrorBase {
    assert(import.meta.jest);
    const error = new UnavailableError("Simulated crash");
    (error as any)[withIndexSearchEntityEmbeddingChunksJobLockSimulatedCrashErrorSymbol] = true;
    return error;
}

/**
 * Called from `processIndexSearchEntityEmbeddingChunksJob()` to acquire a lock
 * on embedding chunks processing for the search entity. If another process
 * currently has the lock then we'll schedule another
 * `IndexSearchEntityEmbeddingChunks` job for later and not call `action`. If
 * we're able to acquire the lock then `action` is called. The lock is released
 * once `action` returns.
 *
 * If the process shuts down while `action` is running the lock will eventually
 * expire.
 */
export async function withIndexSearchEntityEmbeddingChunksJobLock(
    context: ServerActionContext,
    {id: jobId, spaceId, entityId}: {id: Id; spaceId: SpaceId; entityId: SearchDynamicEntityId},
    action: () => Promise<void>,
): Promise<void> {
    const updateExpirationTimeIntervalMs = 15 * 1000;

    // Expire locks after a period of inactivity. We picked this value so that if
    // the process holding the lock crashes OpenSearch will refresh with any
    // partial writes from the crashed process before the next process starts.
    const expirationTimeoutMs =
        searchEntityEmbeddingChunkIndexWaitForRefreshDelayMs + updateExpirationTimeIntervalMs;

    {
        let effect: "Activate" | "Reschedule" | null = null;

        const item = await SearchEntityTable.updateItem(
            context,
            {
                partitionType: "IndexSearchEntityEmbeddingChunksJob",
                sortRangeType: "State",
                spaceId,
                entityId,
            },
            item => {
                // Reset `action` in case `updateItem()` is retried and we previously set
                // `action`.
                effect = null;

                if (!item) return item;
                if (!item.scheduledJobs.some(scheduledJob => scheduledJob.id === jobId))
                    return item;

                const currentTime = new Date();
                let scheduledJobStartTime: Date | null = null;

                // We can't start a new job until the OpenSearch index refreshes after our
                // previous job. So if we haven't waited long enough for an index refresh,
                // reschedule our job.
                if (
                    item.previousJob &&
                    isDatePossiblyLessThanWithUncertaintyWindow(
                        currentTime,
                        item.previousJob.endTime.getTime() +
                            searchEntityEmbeddingChunkIndexWaitForRefreshDelayMs,
                    )
                ) {
                    scheduledJobStartTime = new Date(
                        item.previousJob.endTime.getTime() +
                            searchEntityEmbeddingChunkIndexWaitForRefreshDelayMs +
                            defaultUncertaintyWindowMs / 2,
                    );
                }
                // We can't start a new job if there's an active job unless the active job has
                // expired. So reschedule our job for after the active job's expiration time.
                else if (
                    item.activeJob &&
                    isDatePossiblyLessThanWithUncertaintyWindow(
                        currentTime,
                        item.activeJob.expirationTime,
                    )
                ) {
                    scheduledJobStartTime = new Date(
                        item.activeJob.expirationTime.getTime() + defaultUncertaintyWindowMs / 2,
                    );
                }

                // We rescheduled our job! Don't set it as the `activeJob`. Instead update it
                // in the `scheduledJobs` array.
                if (scheduledJobStartTime !== null) {
                    effect = "Reschedule";

                    const scheduledJobStartDelayMs =
                        scheduledJobStartTime.getTime() - currentTime.getTime();

                    // The max SQS `delaySeconds` is 15min. Make sure we're not scheduling a job
                    // for more than 15min from now.
                    assert(
                        0 <= scheduledJobStartDelayMs && scheduledJobStartDelayMs <= 15 * 60 * 1000,
                    );

                    return {
                        ...item,
                        scheduledJobs: [
                            ...item.scheduledJobs.filter(scheduledJob => scheduledJob.id !== jobId),
                            {
                                id: jobId,
                                startTime: scheduledJobStartTime,
                            },
                        ],
                    };
                }

                effect = "Activate";

                return {
                    ...item,
                    scheduledJobs: item.scheduledJobs.filter(
                        scheduledJob =>
                            scheduledJob.id !== jobId &&
                            // Unschedule any jobs with a scheduled start time that's definitely before the
                            // current time. These scheduled jobs either lost a race condition or (through
                            // some edge case) were never processed by SQS (e.g. server shutdown after
                            // adding to `scheduledJobs` and before actually sending job to SQS).
                            !isDateDefinitelyLessThanWithUncertaintyWindow(
                                scheduledJob.startTime,
                                currentTime,
                            ),
                    ),
                    activeJob: {
                        id: jobId,
                        startTime: currentTime,
                        expirationTime: new Date(currentTime.getTime() + expirationTimeoutMs),
                    },
                };
            },
            // Make sure we didn't read data with an eventual consistency lag by making an
            // `updateLockVersion` condition check even for noop updates.
            {withNoopUpdateLockVersionConditionCheck: true},
        );

        // Reschedule our job to run later...
        if (effect === "Reschedule") {
            const scheduledJob = assertExists(item?.scheduledJobs.find(job => job.id === jobId));

            await context.jobs.sendAndWait(
                {
                    type: "IndexSearchEntityEmbeddingChunks",
                    id: jobId,
                    spaceId,
                    entityId,
                },
                {
                    delaySeconds: Math.max(
                        Math.ceil((scheduledJob.startTime.getTime() - Date.now()) / 1000),

                        // If `scheduledJob.startTime` is in the past then `delaySeconds` would be a
                        // negative number which we can't allow.
                        0,
                    ),
                },
            );
            return;
        }

        // If we weren't activated then bail out! We only want to run `action()` if
        // `updateItem()` successfully activated our job.
        if (effect !== "Activate") return;
    }

    // While our action is running, update our `expirationTime` every 15s. That way
    // another process doesn't come along and steal our lock if the action takes
    // more than `expirationTimeoutMs` to complete.
    const interval = createInterval(() => {
        const promise = (async () => {
            await SearchEntityTable.updateItem(
                context,
                {
                    partitionType: "IndexSearchEntityEmbeddingChunksJob",
                    sortRangeType: "State",
                    spaceId,
                    entityId,
                },
                item => {
                    if (!item?.activeJob) return item;
                    if (item.activeJob.id !== jobId) return item;

                    return {
                        ...item,
                        activeJob: {
                            ...item.activeJob,
                            expirationTime: new Date(Date.now() + expirationTimeoutMs),
                        },
                    };
                },
                // Make sure we didn't read data with an eventual consistency lag by making an
                // `updateLockVersion` condition check even for noop updates.
                {withNoopUpdateLockVersionConditionCheck: true},
            );
        })();

        context.process.waitUntil(promise);
        withIndexSearchEntityEmbeddingChunksJobLockIntervalPromiseWaiterForTest?.waitUntil(promise);
    }, updateExpirationTimeIntervalMs);

    let isError = false;
    let isSimulatedCrashForTest = false;

    try {
        await action();
    } catch (error) {
        isError = true;
        isSimulatedCrashForTest =
            isWithIndexSearchEntityEmbeddingChunksJobLockSimulatedCrashErrorForTest(error);
        throw error;
    } finally {
        interval.clear();

        // Simulated crashes don't run any cleanup.
        if (import.meta.jest && isSimulatedCrashForTest) return;

        const endTime = new Date();

        // Once our action has finished, release the lock.
        await SearchEntityTable.updateItem(
            context,
            {
                partitionType: "IndexSearchEntityEmbeddingChunksJob",
                sortRangeType: "State",
                spaceId,
                entityId,
            },
            item => {
                if (!item?.activeJob) return item;
                if (item.activeJob.id !== jobId) return item;

                // Set `activeJob` to null to release our lock.
                //
                // - If the job succeeded then set `previousJob` so we don't need to read data
                //   again which we've already read (and we wait an appropriate amount of time
                //   before the next job).
                //
                // - If the job failed, SQS is going to retry it automatically so add an entry
                //   back to `scheduledJobs` so we don't skip the retry. If SQS doesn't retry
                //   (since we've hit the retry limit). The entry in `scheduledJobs` will
                //   eventually be cleaned up.
                return {
                    ...item,
                    previousJob: {
                        id: jobId,
                        startTime: item.activeJob.startTime,
                        endTime,
                    },
                    scheduledJobs: isError
                        ? [...item.scheduledJobs, {id: jobId, startTime: item.activeJob.startTime}]
                        : item.scheduledJobs,
                    activeJob: null,
                };
            },
            // Make sure we didn't read data with an eventual consistency lag by making an
            // `updateLockVersion` condition check even for noop updates.
            {withNoopUpdateLockVersionConditionCheck: true},
        );
    }
}

/**
 * Get the bucket our affinity points fall into. We have more buckets near the
 * lower end of the points distribution since it represents items experiencing
 * a slow death.
 *
 * We want to make sure an entity doesn't change buckets too often (since that
 * increases write costs) while still having small enough buckets that are
 * efficient to query (to decrease read costs).
 */
export function getSearchAffinityEntityPointsBucket(points: number): number {
    if (points < 1) return 0;
    if (points < 3) return 1;
    if (points < 5) return 3;
    return Math.floor(points / 5) * 5;
}

/**
 * 30 days (~1 month) in milliseconds.
 */
export const thirtyDaysDurationMs = 1000 * 60 * 60 * 24 * 30;

const searchAffinityExpirationPoints = 0.05;

/**
 * The number of points to add to a task's search affinity score for the task
 * assignee when the task is marked as active. We want active tasks to be at
 * the top of the task assignee's affinity list for a week or so. Since setting
 * a task to "active" is one of the highest signals we have that an entity is
 * currently important to a user.
 *
 * We want the task to be at the very top of a user's affinity list for about
 * a week and then in the top five in the second week. As of 2025-02-21 the
 * points of the top five entities in my (@calebmer's) search affinity list
 * are 71.47, 67.26, 51.62, 42.65, and 36.91. So after seven days this point
 * value needs to decay to something still over 71.47.
 *
 * 150 fits this criteria:
 *
 * - After  7 days it's 74.49
 * - After 14 days it's 36.99
 * - After 30 days it's  7.50
 */
const searchAffinityEntityActiveTaskAssigneePoints = 150;

/**
 * How much to add to a document's search affinity erosion when the document is
 * first created. The points for newly created documents decay faster so if the
 * user creates a document to demonstrate something quickly, types a couple
 * characters, then closes it, the document won't show up at the top of their
 * affinity list for weeks.
 *
 * This value is picked so that after ~40min of continuous editing erosion will
 * be 0. 40min is longer than a short, 40min meeting. So meeting notes from a
 * 40min meeting will have non-zero erosion. But a user will likely spend more
 * than 40min on an important work artifact.
 *
 * Let's go through the math:
 *
 * - `useSearchAffinityViewEntityInteraction()` is configured to send a `View`
 *   interaction which adds 1 point every 5 minutes.
 *
 * - `markSearchAffinityLowIntentUpdateEntityInteraction()` is configured to
 *   send a `VeryLowIntentUpdate` interaction which adds 0.0625 points every 24
 *   seconds (0.8 minutes).
 *
 * View interaction points after 30 minutes is 8 (1 * 40 / 5). Update
 * interaction points after 30 minutes is 3.125 (0.0625 * 40 / 0.8). Sum those
 * up and you get 11.125. We lower that to a clean number, 10, since in
 * document editing cases users are rarely viewing or typing continuously for
 * 40min so we need some grace.
 */
const searchAffinityEntityDocumentCreatorErosion = 10;

/**
 * The number of points to add to a document's search affinity score when the
 * document is first created. We want documents to be at the top of the
 * document creator's affinity list for two to three days if they have enough
 * edits to get to 0 erosion and only one day if they're still at a max erosion
 * of 10 (see `searchAffinityEntityDocumentCreatorErosion`). This way the
 * creator can easily get back to the documents they recently created without
 * small one off documents dominating the affinity list.
 *
 * As of 2025-02-21 the points of the top five entities in my (@calebmer's)
 * search affinity list are 71.47, 67.26, 51.62, 42.65, and 36.91. So after
 * three days this point value needs to decay to something between 71.47 and
 * 42.65 (when erosion is 0).
 *
 * 60 fits this criteria. Here's a table of what 60 points decays to with
 * various erosion values.
 *
 * |---------------|------------|------------|------------|------------|
 * |               |  Erosion 0 |  Erosion 2 |  Erosion 5 | Erosion 10 |
 * |---------------|------------|------------|------------|------------|
 * | After  1 day  |      54.29 |      52.16 |      49.12 |      44.45 |
 * | After  2 days |      49.12 |      45.35 |      40.22 |      32.93 |
 * | After  3 days |      44.45 |      39.42 |      32.93 |      24.39 |
 * | After  7 days |      29.80 |      22.52 |      14.80 |       7.35 |
 * | After 14 days |      14.80 |       8.45 |       3.65 |       0.90 |
 * | After 30 days |       2.99 |       0.90 |       0.15 |       0.01 |
 * |---------------|------------|------------|------------|------------|
 *
 * [Script used to generate this table][1].
 *
 * [1]: https://gist.github.com/calebmer/9f9c96ef90bb9aff2a16c711e2867257
 */
const searchAffinityEntityDocumentCreatorPoints = 60;

/**
 * Apply our exponential decay function to figure out how many affinity points
 * we currently have.
 *
 * Our base function is `f(t) = e^-3t` where `t` is measured in months. This
 * function will decay 1 point to 0.05 (which we round down to 0) in 1 month.
 *
 * Adding erosion to the function we get `f(t) = e^-(3(1 + r))t` where `r`
 * represents erosion and is between 0 and 1. If erosion is at its max, 1, then
 * we decay twice as fast. It only takes 1 point 0.5 months to decay to 0.05.
 * `r` is computed by `clamp(0, erosion / 10, 1)`. 10 is a magic constant
 * picked to equal `searchAffinityEntityDocumentCreatorErosion`. It doesn't
 * have to equal `searchAffinityEntityDocumentCreatorErosion` but we're
 * starting there so max document erosion is also max erosion for the purposes
 * of this function.
 */
export function getCurrentSearchAffinityEntityPoints(
    currentTime: number,
    {
        points,
        erosion,
        lastUpdatedTime,
    }: {
        points: number;
        erosion: number;
        lastUpdatedTime: number;
    },
): number {
    const elapsedTime = currentTime - lastUpdatedTime;
    const erosionFactor = clamp(0, erosion / 10, 1);

    return points * Math.exp(-(3 * (1 + erosionFactor) * (elapsedTime / thirtyDaysDurationMs)));
}

/**
 * Return the duration in milliseconds for `points` to decay to 0.05 (which we
 * round down to 0). We set an expiration time on our item with this number.
 *
 * We get this function by putting `p = e^-(3(1 + r))t` into an algebra solver
 * and asking it to solve for `t`. Since `p` is 0.05. What we get is
 * `t = log(1 / p) / (3r + 3)`.
 */
export function getSearchAffinityEntityExpirationDuration({
    points,
    erosion,
}: {
    points: number;
    erosion: number;
}): number {
    // Anything less than expiration points is a negative number.
    if (points <= searchAffinityExpirationPoints) return 0;

    const erosionFactor = clamp(0, erosion / 10, 1);

    return (
        (Math.log(points / searchAffinityExpirationPoints) / (3 * erosionFactor + 3)) *
        thirtyDaysDurationMs
    );
}

/**
 * Mutably assigns the computed properties `pointsBucket` and `expirationTime`
 * to an item object. Exported for tests.
 */
export function assignSearchAffinityEntityDerivedAttributes<
    const Item extends {
        points: number;
        erosion: number;
        lastUpdatedTime: number;
        favoriteOrderKey: OrderKey | null;
    },
>(
    item: Item,
): Item & {
    pointsBucket: number;
    expirationTime: Date | null;
} {
    const pointsBucket = getSearchAffinityEntityPointsBucket(item.points);

    if (item.favoriteOrderKey !== null) {
        return Object.assign(item, {
            pointsBucket,
            expirationTime: null,
        });
    } else {
        return Object.assign(item, {
            pointsBucket,
            expirationTime: new Date(
                item.lastUpdatedTime + Math.ceil(getSearchAffinityEntityExpirationDuration(item)),
            ),
        });
    }
}

function getSearchAffinityEntityInteractionPoints(
    interaction: SearchAffinityEntityInteraction,
): number {
    switch (interaction.type) {
        case "View":
            return 1;
        case "VeryLowIntentUpdate":
            return 0.0625;
        case "LowIntentUpdate":
            return 0.2;
        case "MediumIntentUpdate":
            return 1;
        case "HighIntentUpdate":
            return 3;
        default:
            throw exhaustive(interaction);
    }
}

/**
 * Add some points to an account's affinity score for an entity. 1 point will
 * decay to 0 after 3 months (more accurately, 90 days).
 *
 * We don't let you directly pass in a point number. Instead you must pass in a
 * `SearchAffinityEntityInteraction` object. This interaction object abstracts
 * away the point count so the caller only needs to think about what kind of
 * interaction it was, not the right point total relative to all other point
 * counts.
 *
 * Sometimes this function is called from the server. Sometimes this function
 * is called from the client. It doesn't really matter. Wherever is more
 * convenient is fine. Usually, calling this function after an update on the
 * server is most convenient since you guarantee an affinity update after the
 * actual database update. However, sometimes it's useful to throttle calls to
 * this function (e.g. typing in a document) which is easiest to do on
 * the client.
 */
// TODO(calebmer): I wonder if we should add a "mobile multiplier" to some of
// these interactions. Since all of these interactions are harder to do on
// mobile that must mean it's worth more to the user?
export function markSearchAffinityEntityInteraction(
    context: ServerSessionActionContext | ServerImpersonatedAccountActionContext,
    {
        spaceId,
        entityId,
        interaction,
    }: {
        spaceId: SpaceId;
        entityId: SearchAffinityEntityId;
        interaction: SearchAffinityEntityInteraction;
    },
) {
    return addSearchAffinityEntityPoints(context, {
        spaceId,
        accountId: context.actor.getAccountId(),
        entityId,
        points: getSearchAffinityEntityInteractionPoints(interaction),
        isViewInteraction: interaction.type === "View",
    });
}

/**
 * `markSearchAffinityEntityInteraction()` but on behalf of another account.
 * Only system actors can do this. Session actors aren't allowed to update
 * affinity points for another account.
 */
export function markSearchAffinityEntityInteractionForAccount(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: SystemActorContextModule;
    }>,
    {
        spaceId,
        accountId,
        entityId,
        interaction,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        entityId: SearchAffinityEntityId;
        interaction: SearchAffinityEntityInteraction;
    },
) {
    // Make sure we're using a system actor.
    context.actor.authorizeSystem();

    return addSearchAffinityEntityPoints(context, {
        spaceId,
        accountId,
        entityId,
        points: getSearchAffinityEntityInteractionPoints(interaction),
        isViewInteraction: interaction.type === "View",
    });
}

/**
 * Same as `markSearchAffinityEntityInteraction()` but for a special "create
 * document" interaction. This interaction may only be performed on the server
 * as it adds a lot of points we don't want the client to be able to add.
 */
export function markSearchAffinityCreateDocumentEntityInteraction(
    context: ServerSessionActionContext,
    {
        spaceId,
        documentId,
    }: {
        spaceId: SpaceId;
        documentId: DocumentId;
    },
) {
    return addSearchAffinityEntityPoints(context, {
        spaceId,
        accountId: context.actor.getAccountId(),
        entityId: `Document:${documentId}`,
        points: searchAffinityEntityDocumentCreatorPoints,
        erosion: searchAffinityEntityDocumentCreatorErosion,
        isViewInteraction: false,
    });
}

async function addSearchAffinityEntityPoints(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    {
        spaceId,
        accountId,
        entityId,
        points: pointsIncrement,
        erosion: erosionIncrement = 0,
        isViewInteraction,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        entityId: SearchAffinityEntityId;
        points: number;
        erosion?: number;
        isViewInteraction: boolean;
    },
) {
    // Optimization: We don't authorize whether the actor has access to the entity.
    // Since this is a personal score it doesn't really matter if the user gives
    // themselves affinity points to an entity they don't have access to.

    const [, , isBot] = await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeOwnSpaceAccountAccess(context, accountId),
        isBotSpaceAccount(context, spaceId, accountId),
    ]);

    // Bots don't accumulate affinity points
    if (isBot) return;

    // Make sure increments are positive and finite.
    if (pointsIncrement < 0 || isNaN(pointsIncrement) || !Number.isFinite(pointsIncrement))
        throw new InvalidArgumentError("Search affinity points increment must be a positive");
    if (erosionIncrement < 0 || isNaN(erosionIncrement) || !Number.isFinite(erosionIncrement))
        throw new InvalidArgumentError("Search affinity erosion increment must be positive");

    const currentTime = Date.now();

    const channelId = entityId.startsWith("Channel:")
        ? assertId<ChannelId>(entityId.slice(8))
        : null;
    const collectionId = entityId.startsWith("TaskCollection:")
        ? assertId<TaskCollectionId>(entityId.slice(15))
        : null;

    await runAllPromises([
        SearchEntityTable.updateItem(
            context,
            {
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId,
                accountId,
                entityId,
            },
            item => {
                let points = item ? getCurrentSearchAffinityEntityPoints(currentTime, item) : 0;

                points += pointsIncrement;

                const erosion =
                    Math.max(0, (item?.erosion ?? 0) - pointsIncrement) + erosionIncrement;

                return assignSearchAffinityEntityDerivedAttributes({
                    ...item,
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId,
                    accountId,
                    entityId,
                    points,
                    erosion,
                    lastUpdatedTime: currentTime,
                    favoriteOrderKey: item?.favoriteOrderKey ?? null,
                });
            },
        ),

        // We maintain a space-wide affinity list for channels. So when a user is
        // selecting a channel to post in we have a good recommended list of channels.
        //
        // View interactions don't contribute to the space-wide channel affinity list.
        // Since viewing a channel is personal and not observable by others. If a user
        // reads every post in a channel over the course of a couple hours, that isn't
        // good signal that the channel will be useful to everyone in the organization.
        channelId && !isViewInteraction
            ? SearchEntityTable.updateItem(
                  context,
                  {
                      partitionType: "SpaceChannels",
                      sortRangeType: "SearchAffinity",
                      spaceId,
                      channelId,
                  },
                  item => {
                      let points = item
                          ? getCurrentSearchAffinityEntityPoints(currentTime, item)
                          : 0;

                      points += pointsIncrement;

                      assert(erosionIncrement === 0);

                      const erosion =
                          Math.max(0, (item?.erosion ?? 0) - pointsIncrement) + erosionIncrement;

                      // `erosion` should always be zero since the previous erosion is 0 and
                      // `erosionIncrement` is 0.
                      assert(erosion === 0);

                      return assignSearchAffinityEntityDerivedAttributes({
                          ...item,
                          partitionType: "SpaceChannels",
                          sortRangeType: "SearchAffinity",
                          spaceId,
                          channelId,
                          points,
                          erosion,
                          lastUpdatedTime: currentTime,
                          favoriteOrderKey: null,
                      });
                  },
              )
            : null,

        // We maintain a space-wide affinity list for task collections. So when a user
        // is selecting collections for their tasks we have a good recommended list of
        // collections.
        //
        // View interactions don't contribute to the space-wide task collection
        // affinity list.
        collectionId && !isViewInteraction
            ? SearchEntityTable.updateItem(
                  context,
                  {
                      partitionType: "SpaceTaskCollections",
                      sortRangeType: "SearchAffinity",
                      spaceId,
                      collectionId,
                  },
                  item => {
                      let points = item
                          ? getCurrentSearchAffinityEntityPoints(currentTime, item)
                          : 0;

                      points += pointsIncrement;

                      assert(erosionIncrement === 0);

                      const erosion =
                          Math.max(0, (item?.erosion ?? 0) - pointsIncrement) + erosionIncrement;

                      // `erosion` should always be zero since the previous erosion is 0 and
                      // `erosionIncrement` is 0.
                      assert(erosion === 0);

                      return assignSearchAffinityEntityDerivedAttributes({
                          ...item,
                          partitionType: "SpaceTaskCollections",
                          sortRangeType: "SearchAffinity",
                          spaceId,
                          collectionId,
                          points,
                          erosion,
                          lastUpdatedTime: currentTime,
                          favoriteOrderKey: null,
                      });
                  },
              )
            : null,
    ]);
}

/**
 * Allow tests to directly add some number of points.
 */
export async function addSearchAffinityEntityPointsForTest(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    options: {
        spaceId: SpaceId;
        accountId: AccountId;
        entityId: SearchAffinityEntityId;
        points: number;
        erosion?: number;
    },
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    await addSearchAffinityEntityPoints(context, {...options, isViewInteraction: false});
}

/**
 * Adds a boost of search affinity points when a task is marked as active. This
 * should boost the task to the top of the account's search affinity list where
 * the task should stay for a while. This way whenever a user sees their search
 * affinity list, they're reminded of the tasks they're currently working on.
 * Without needing to open the task product.
 *
 * This function is idempotent. You may call it multiple times and we'll only
 * apply the boost once.
 *
 * You must call this function with a system actor since it may update search
 * affinity points on behalf of another user.
 */
export async function addSearchAffinityEntityActiveTaskAssigneePoints(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: SystemActorContextModule;
    }>,
    {
        spaceId,
        assigneeId,
        taskId,
    }: {
        spaceId: SpaceId;
        assigneeId: AccountId;
        taskId: TaskId;
    },
) {
    // A system actor is required since we may be updating search affinity on
    // behalf of a user other than the one making the action. So we need a trusted
    // actor. For example, your manager may mark a task assigned to you as active
    // on your behalf.
    //
    // If Alice (a malicious user) tries to get Bob's attention by assigning them
    // to a task and setting it as active then Bob can simply unassign themselves
    // to remove the task from the top of their affinity list. This makes adding
    // affinity points to the assignee of an active task no more harmful then
    // sending a notification after an @ mention (which can be dismissed).
    context.actor.authorizeSystem();

    // Bots don't accumulate affinity points
    if (await isBotSpaceAccount(context, spaceId, assigneeId)) return;

    const currentTime = Date.now();

    await context.dynamo.retryTransaction(async context => {
        const item = await SearchEntityTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId,
            accountId: assigneeId,
            entityId: `Task:${taskId}`,
        });

        const pointsIncrement = searchAffinityEntityActiveTaskAssigneePoints;

        const points =
            (item ? getCurrentSearchAffinityEntityPoints(currentTime, item) : 0) + pointsIncrement;

        // Marking a task as active sets erosion to 0 even if it was non-zero before.
        const erosion = 0;

        if (!item) {
            await SearchEntityTable.createItem(
                context,
                assignSearchAffinityEntityDerivedAttributes({
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId,
                    accountId: assigneeId,
                    entityId: `Task:${taskId}`,
                    points,
                    erosion,
                    lastUpdatedTime: currentTime,
                    favoriteOrderKey: null,
                    activeTaskAssignee: {
                        points: pointsIncrement,
                        erosion,
                        lastUpdatedTime: currentTime,
                    },
                }),
                {isConditionCheckErrorRetriable: true},
            );
        } else if (item.activeTaskAssignee) {
            // If the item already has active task assignee points, make sure with a
            // [serializable isolation level][1] that the item version number is exactly
            // what we read. This makes sure our eventually consistent read didn't see an
            // outdated item.
            //
            // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-isolation
            await DynamoTableSchema.executeTransaction(context, [
                SearchEntityTable.transactionUpdateLockVersionConditionCheck(
                    {
                        partitionType: "Account",
                        sortRangeType: "SearchEntityAffinity",
                        spaceId,
                        accountId: assigneeId,
                        entityId: `Task:${taskId}`,
                    },
                    item.updateLockVersion,
                ),
            ]);
        } else {
            await SearchEntityTable.directlyUpdateItem(
                context,
                assignSearchAffinityEntityDerivedAttributes({
                    ...item,
                    points,
                    erosion,
                    lastUpdatedTime: currentTime,
                    activeTaskAssignee: {
                        points: pointsIncrement,
                        erosion,
                        lastUpdatedTime: currentTime,
                    },
                }),
            );
        }
    });
}

/**
 * Removes points from the boost provided by
 * `addSearchAffinityEntityActiveTaskAssigneePoints()` when a task is marked as
 * inactive. This will set the search affinity item to the number of points it
 * would have if the item were never boosted in the first place.
 *
 * This function is idempotent. You may call it multiple times and we'll only
 * apply the boost once.
 *
 * You must call this function with a system actor since it may update search
 * affinity points on behalf of another user.
 */
export async function removeSearchAffinityEntityActiveTaskAssigneePoints(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: SystemActorContextModule;
    }>,
    {
        spaceId,
        assigneeId,
        taskId,
    }: {
        spaceId: SpaceId;
        assigneeId: AccountId;
        taskId: TaskId;
    },
) {
    // A system actor is required since we may be updating search affinity on
    // behalf of a user other than the one making the action. So we need a trusted
    // actor. For example, your manager may mark a task assigned to you as active
    // on your behalf.
    //
    // If Alice (a malicious user) tries to get Bob's attention by assigning them
    // to a task and setting it as active then Bob can simply unassign themselves
    // to remove the task from the top of their affinity list. This makes adding
    // affinity points to the assignee of an active task no more harmful then
    // sending a notification after an @ mention (which can be dismissed).
    context.actor.authorizeSystem();

    // Bots don't accumulate affinity points
    if (await isBotSpaceAccount(context, spaceId, assigneeId)) return;

    const currentTime = Date.now();

    await context.dynamo.retryTransaction(async context => {
        const item = await SearchEntityTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId,
            accountId: assigneeId,
            entityId: `Task:${taskId}`,
        });

        if (!item?.activeTaskAssignee) {
            // If the item already has active task assignee points, make sure with a
            // [serializable isolation level][1] that the item version number is exactly
            // what we read. This makes sure our eventually consistent read didn't see an
            // outdated item.
            //
            // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-isolation
            await DynamoTableSchema.executeTransaction(context, [
                item
                    ? SearchEntityTable.transactionUpdateLockVersionConditionCheck(
                          {
                              partitionType: "Account",
                              sortRangeType: "SearchEntityAffinity",
                              spaceId,
                              accountId: assigneeId,
                              entityId: `Task:${taskId}`,
                          },
                          item.updateLockVersion,
                      )
                    : SearchEntityTable.transactionDoesNotExistConditionCheck(
                          {
                              partitionType: "Account",
                              sortRangeType: "SearchEntityAffinity",
                              spaceId,
                              accountId: assigneeId,
                              entityId: `Task:${taskId}`,
                          },
                          // If the item doesn't exist, either there's some eventual consistency lag or the item
                          // was created in parallel _after_ our `getItemIfExists()` network call but _before_ our
                          // `executeTransaction()` network call. Retry our `context.dynamo.retryTransaction()`
                          // loop so we can load the newly created item.
                          {isConditionCheckErrorRetriable: true},
                      ),
            ]);
        } else {
            const points =
                getCurrentSearchAffinityEntityPoints(currentTime, item) -
                getCurrentSearchAffinityEntityPoints(currentTime, item.activeTaskAssignee);

            if (
                points <= searchAffinityExpirationPoints &&
                // Don't delete the affinity item if it's a favorite.
                typeof item.favoriteOrderKey !== "string"
            ) {
                await SearchEntityTable.deleteItem(context, item);
            } else {
                await SearchEntityTable.directlyUpdateItem(
                    context,
                    assignSearchAffinityEntityDerivedAttributes({
                        ...item,
                        points,
                        lastUpdatedTime: currentTime,
                        activeTaskAssignee: undefined,
                    }),
                );
            }
        }
    });
}

/**
 * Clear all affinity points related with the entity.
 */
export async function clearSearchEntityAffinity(
    context: ServerSessionActionContext,
    {spaceId, entityId}: {spaceId: SpaceId; entityId: SearchAffinityEntityId},
) {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't accumulate affinity points
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await SearchEntityTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId,
            accountId,
            entityId,
        },
        item => {
            const currentTime = Date.now();

            const newItem: SearchAffinityEntityItem = assignSearchAffinityEntityDerivedAttributes({
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId,
                accountId,
                entityId,
                favoriteOrderKey: null,
                ...item,
                points: 0,
                erosion: 0,
                lastUpdatedTime: currentTime,
            });

            // Delete the item from the database if setting `points` to 0 expires the item.
            // Which it will unless `favoriteOrderKey` is set.
            if (
                newItem.expirationTime !== null &&
                newItem.expirationTime.getTime() <= currentTime
            ) {
                return null;
            }

            return newItem;
        },
    );
}

/**
 * We iterate through the `AccountAffinitiveSearchEntitiesIndex` index until we
 * see the points bucket change. Instead of reading the max 1 MB DynamoDB page
 * read 100 items at a time and we'll interrupt pagination once we have the
 * data we need.
 *
 * Worst-case we may need to iterate through all account affinity items.
 */
export const searchAffinityEntityQueryPageLimit = 100;

export const getSearchAffinitiesEarlyReturnTestCounter = new TestCounter<AccountId>();

/**
 * Get `SearchAffinityEntityId`s that are meaningful to the actor.
 *
 * Labeled "internal" since you should be calling `searchByAffinity()`. This
 * function returns affinitive entities along with extra information about them
 * like the entity's title. This function also doesn't filter out entities the
 * account has lost access to! While this function isn't unsafe with regards to
 * permissions (it's fine to know the `SearchAffinityEntityId` of something you
 * used to have access to) it isn't the most convenient function so we label it
 * "internal" but not "dangerous".
 *
 * This function does not change entity ranking based on whether an entity is
 * in the actor's affinity list or not. It's expected that `searchByAffinity()`
 * will re-rank using the actor's favorite list.
 */
export async function internalGetSearchAffinityEntities(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<{
        entityId: SearchAffinityEntityId;
        points: number;
        favoriteOrderKey: OrderKey | null;
    }>
> {
    const accountId = context.actor.getAccountId();

    const results = await internalGetSearchAffinitiesEntitiesBase(context, {
        spaceId,
        limit,
        queryItems: () =>
            filterAsyncIterableIterator(
                AccountSearchAffinityEntitiesIndex.query(context, {
                    partitionKey: {
                        accountId,
                        spaceId,
                    },
                    descending: true,
                    limit: "All",
                    pageLimit: searchAffinityEntityQueryPageLimit,
                }),
                item =>
                    // NOTE(calebmer, 2025-03-18): Needed for backwards compatibility. We used to
                    // have a task notepad affinity entity. Make sure we don't return it from this
                    // function since it will cause problems. Eventually (maybe in six months?),
                    // affinity items for `entityId` `TaskNotepad` will expire and we can
                    // remove this.
                    (item as any).entityId !== "TaskNotepad",
            ),
        deleteItem: item => {
            assert(typeof item.favoriteOrderKey !== "string");
            return SearchEntityTable.deleteItem(context, item);
        },
        directlyUpdateItem: (item, newAttributes) =>
            SearchEntityTable.directlyUpdateItem(context, {...item, ...newAttributes}),
    });

    return results.map(result => ({
        entityId: result.item.entityId,
        points: result.points,
        favoriteOrderKey: result.item.favoriteOrderKey,
    }));
}

/**
 * Get `ChannelId`s that are meaningful in the provided space.
 *
 * Labeled "internal" and "dangerous" since we don't do any filtering that the
 * channel still exists or the actor has access. It would be bad to give the
 * user a list of `ChannelId`s they don't have access to! While they couldn't
 * do anything with those `ChannelId`s (they couldn't open it via URL, they'd
 * get a `PermissionDeniedError`) an attacker may be able to use information
 * about popular private channels to infer something they shouldn't know.
 */
export async function internalDangerouslyGetSpaceChannelSearchAffinityEntities(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<{
        points: number;
        item: {channelId: ChannelId};
    }>
> {
    return internalGetSearchAffinitiesEntitiesBase(context, {
        spaceId,
        limit,
        queryItems: () =>
            SpaceChannelSearchAffinityEntitiesIndex.query(context, {
                partitionKey: {spaceId},
                descending: true,
                limit: "All",
                pageLimit: searchAffinityEntityQueryPageLimit,
            }),
        deleteItem: item => {
            assert(typeof item.favoriteOrderKey !== "string");
            return SearchEntityTable.deleteItem(context, item);
        },
        directlyUpdateItem: (item, newAttributes) =>
            SearchEntityTable.directlyUpdateItem(context, {
                ...item,
                ...newAttributes,
                // `expirationTime` will only be null if `favoriteOrderKey` is non-null.
                // `favoriteOrderKey` is always null for space-level channel search affinities.
                expirationTime: assertExists(newAttributes.expirationTime),
            }),
    });
}

/**
 * Get `TaskCollectionId`s that are meaningful in the provided space.
 *
 * Labeled "internal" and "dangerous" since we don't do any filtering that the
 * collection still exists or the actor has access. It would be bad to give the
 * user a list of `TaskCollectionId`s they don't have access to! While they
 * couldn't do anything with those `TaskCollectionId`s (they couldn't open it
 * via URL, they'd get a `PermissionDeniedError`) an attacker may be able to
 * use information about popular private collections to infer something they
 * shouldn't know.
 */
export async function internalDangerouslyGetSpaceTaskCollectionSearchAffinityEntities(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<{
        points: number;
        item: {collectionId: TaskCollectionId};
    }>
> {
    return internalGetSearchAffinitiesEntitiesBase(context, {
        spaceId,
        limit,
        queryItems: () =>
            SpaceTaskCollectionSearchAffinityEntitiesIndex.query(context, {
                partitionKey: {spaceId},
                descending: true,
                limit: "All",
                pageLimit: searchAffinityEntityQueryPageLimit,
            }),
        deleteItem: item => {
            assert(typeof item.favoriteOrderKey !== "string");
            return SearchEntityTable.deleteItem(context, item);
        },
        directlyUpdateItem: (item, newAttributes) =>
            SearchEntityTable.directlyUpdateItem(context, {
                ...item,
                ...newAttributes,
                // `expirationTime` will only be null if `favoriteOrderKey` is non-null.
                // `favoriteOrderKey` is always null for space-level task collection search
                // affinities.
                expirationTime: assertExists(newAttributes.expirationTime),
            }),
    });
}

/**
 * Base function for reading a search affinity index.
 *
 * In theory, affinities are always getting exponentially smaller but we store
 * items that represent a snapshot of the points value in time. We sort our
 * DynamoDB index based on point buckets. However, the item's position in our
 * index might be lower as the item's points have decayed. An item may be lower
 * in our index but will never be higher. So we need to search enough of our
 * index to be confident we actually have the top affinitive entities.
 */
async function internalGetSearchAffinitiesEntitiesBase<
    Item extends {
        points: number;
        pointsBucket: number;
        erosion: number;
        lastUpdatedTime: number;
        favoriteOrderKey: OrderKey | null;
    },
>(
    context: ServerSessionActionContext,
    {
        spaceId,
        limit,
        queryItems,
        deleteItem,
        directlyUpdateItem,
    }: {
        spaceId: SpaceId;
        limit: number;
        queryItems: () => AsyncIterableIterator<Item>;
        deleteItem: (item: Item) => Promise<void>;
        directlyUpdateItem: (
            item: Item,
            newAttributes: {
                points: number;
                pointsBucket: number;
                lastUpdatedTime: number;
                expirationTime: Date | null;
            },
        ) => Promise<unknown>;
    },
): Promise<
    Array<{
        points: number;
        item: Item;
    }>
> {
    await authorizeSpaceAccess(context, spaceId);

    const accountId = context.actor.getAccountId();
    const currentTime = Date.now();
    let lastIterationPointsBucket: number | null = null;

    const candidateItems: Array<{
        points: number;
        pointsBucket: number;
        item: Item;
    }> = [];

    for await (const item of queryItems()) {
        // When iteration enters a new `pointsBucket` check if we can return...
        if (
            lastIterationPointsBucket !== null &&
            lastIterationPointsBucket !== item.pointsBucket &&
            candidateItems.length >= limit
        ) {
            candidateItems.sort((a, b) => b.points - a.points);

            const limitCandidateItem = candidateItems[limit - 1]!;

            // If we've entered a point bucket that's smaller than the last candidate item
            // we'd return for `limit` (`limitCandidateItem`) then we know even if we
            // continued iterating to the end of the account's affinities we won't find
            // items with a higher score than `limitCandidateItem`. So we can return!
            if (limitCandidateItem.pointsBucket > item.pointsBucket) {
                getSearchAffinitiesEarlyReturnTestCounter.incrementForTest(accountId);
                return candidateItems.slice(0, limit);
            }
        }

        lastIterationPointsBucket = item.pointsBucket;

        const currentPoints = getCurrentSearchAffinityEntityPoints(currentTime, item);
        const currentPointsBucket = getSearchAffinityEntityPointsBucket(currentPoints);

        candidateItems.push({
            points: currentPoints,
            pointsBucket: currentPointsBucket,
            item,
        });

        // If the item moved buckets and hasn't been updated in half a month, then
        // update the item in DynamoDB to its current bucket location. This helps keep
        // this function efficient as account affinities are kept roughly sorted in the
        // database.
        if (
            currentPointsBucket !== item.pointsBucket &&
            currentTime - item.lastUpdatedTime > thirtyDaysDurationMs / 2
        ) {
            context.process.waitUntil(async () => {
                try {
                    if (
                        currentPoints <= searchAffinityExpirationPoints &&
                        // Don't delete the affinity item if it's a favorite.
                        typeof item.favoriteOrderKey !== "string"
                    ) {
                        await deleteItem(item);
                    } else {
                        await directlyUpdateItem(
                            item,
                            assignSearchAffinityEntityDerivedAttributes({
                                points: currentPoints,
                                erosion: item.erosion,
                                lastUpdatedTime: currentTime,
                                favoriteOrderKey: item.favoriteOrderKey,
                            }),
                        );
                    }
                } catch (error) {
                    // If a concurrent writer updated the item before we could, don't bother
                    // retrying. The writer should have updated points to the current time for us.
                    if (isDynamoConditionCheckError(error)) return;

                    throw error;
                }
            });
        }
    }

    candidateItems.sort((a, b) => b.points - a.points);

    const items = candidateItems.slice(0, limit);

    // Remove items with points less than `searchAffinityExpirationPoints`. We may
    // have these items in the database before expiration removes them or if the
    // user has a favorite that never expires but has low points.
    let endIndex = items.length;
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.points <= searchAffinityExpirationPoints) {
            endIndex--;
        } else {
            break;
        }
    }

    if (endIndex === items.length) {
        return items;
    } else {
        return items.slice(0, endIndex);
    }
}

type GetSearchAffinityEntityIdType<
    SearchAffinityEntityIdType extends SearchAffinityEntityId,
    IdType extends Id,
> = SearchAffinityEntityIdType extends `${infer AffinityType}:${IdType}` ? AffinityType : never;

async function querySessionActorSearchAffinityEntities<IdType extends Id>(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    entityType: GetSearchAffinityEntityIdType<SearchAffinityEntityId, IdType>,
): Promise<Array<IdType>> {
    await authorizeSpaceAccess(context, spaceId);

    const currentTime = Date.now();

    const items = await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            SearchEntityTable.query(context, {
                partitionKey: {
                    partitionType: "Account",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                startSortKey: {
                    sortRangeType: "SearchEntityAffinity",
                    entityId:
                        `${entityType}:${DynamoKeyAttributeSchema.id.getMinValue<IdType>()}` as SearchAffinityEntityId,
                },
                endSortKey: {
                    sortRangeType: "SearchEntityAffinity",
                    entityId:
                        `${entityType}:${DynamoKeyAttributeSchema.id.getMaxValue<IdType>()}` as SearchAffinityEntityId,
                },
                limit: "All",
            }),
            item => ({
                entityId: item.entityId,
                points: getCurrentSearchAffinityEntityPoints(currentTime, item),
                favoriteOrderKey: item.favoriteOrderKey,
            }),
        ),
    );

    const topFavoriteItems = Array.from(
        filterIterable(items, item => item.favoriteOrderKey !== null),
    )
        .sort((item1, item2) => {
            assert(item1.favoriteOrderKey !== null);
            assert(item2.favoriteOrderKey !== null);

            return (
                defaultCompareStrings(item1.favoriteOrderKey, item2.favoriteOrderKey) ||
                defaultCompareStrings(item1.entityId, item2.entityId)
            );
        })
        .slice(0, 3);

    items.sort((item1, item2) => {
        const topFavoriteIndex1 =
            item1.favoriteOrderKey !== null
                ? topFavoriteItems.findIndex(otherItem => otherItem.entityId === item1.entityId)
                : -1;

        const topFavoriteIndex2 =
            item2.favoriteOrderKey !== null
                ? topFavoriteItems.findIndex(otherItem => otherItem.entityId === item2.entityId)
                : -1;

        // The top 3 favorite items are put at the top of the list. After which we sort
        // items by points. This way the user has some explicit control over their
        // type-specific affinity list through favorites but you can't completely
        // override our machine intelligence by having a lot of favorites.
        //
        // We expect our affinity system to generally produce better results for the
        // user then looking through a sorted list of 10+ favorites.
        if (topFavoriteIndex1 >= 0 && topFavoriteIndex2 >= 0)
            return topFavoriteIndex1 - topFavoriteIndex2;
        if (topFavoriteIndex1 >= 0) return -1;
        if (topFavoriteIndex2 >= 0) return 1;

        return item2.points - item1.points;
    });

    // NOTE(calebmer): We don't delete items below 0.05 points or update items that
    // moved point buckets in this function. That's because the DynamoDB TTL should
    // automatically expire items (so we don't have to) and the points bucket
    // doesn't matter for the performance of this function. So spare the points
    // bucket update cost.
    return items.map(item => item.entityId.slice(entityType.length + 1) as IdType);
}

/**
 * Get all accounts our actor has an affinity for sorted by affinity score in
 * the context of a space. We display accounts in this order when the user goes
 * to mention someone or send a message.
 *
 * `AccountId`s in the returned array may no longer be a part of the space.
 * Hence the name "possibly stale".
 *
 * If the actor has some favorited accounts then we'll put up to three of their
 * favorited accounts at the start of the array.
 */
export async function getPossiblyStaleAccountSearchAffinityEntityIds(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<Array<AccountId>> {
    return querySessionActorSearchAffinityEntities<AccountId>(context, spaceId, "Account");
}

/**
 * Get all channels our actor has an affinity for sorted by affinity score in
 * the context of a space. We display channels in this order when the user is
 * selecting a channel to post in.
 *
 * The actor may not have access to all returned `ChannelId`s. They probably
 * had access at some point in time in order to collect affinity points but you
 * need to make sure the actor currently has access before returning
 * `ChannelId`s to them. Hence the name "possibly stale".
 *
 * If the actor has some favorited channels then we'll put up to three of their
 * favorited channels at the start of the array.
 */
export async function getPossiblyStaleChannelSearchAffinityEntityIds(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<Array<ChannelId>> {
    return querySessionActorSearchAffinityEntities<ChannelId>(context, spaceId, "Channel");
}

/**
 * Get all task collections our actor has an affinity for sorted by affinity
 * score. We display collections in this order when the user is selecting a
 * collection for a task.
 *
 * The actor may not have access to all returned `TaskCollectionId`s. They
 * probably had access at some point in time in order to collect affinity
 * points but you need to make sure the actor currently has access before
 * returning `TaskCollectionId`s to them. Hence the name "possibly stale".
 *
 * If the actor has some favorited task collections then we'll put up to three
 * of their favorited task collections at the start of the array.
 */
export async function getPossiblyStaleTaskCollectionSearchAffinityEntityIds(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<Array<TaskCollectionId>> {
    return querySessionActorSearchAffinityEntities<TaskCollectionId>(
        context,
        spaceId,
        "TaskCollection",
    );
}

/**
 * Adds a search entity to the end of the session actor's favorites list. If
 * the entity is already in the session actor's favorites list then we won't
 * move the entity.
 */
export async function favoriteSearchEntity(
    context: ServerSessionActionContext,
    {spaceId, entityId}: {spaceId: SpaceId; entityId: SearchAffinityEntityId},
): Promise<{orderKey: OrderKey}> {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        // Optimization: We don't authorize whether the actor has access to the entity.
        // Since this is a personal favorite list it doesn't really matter if the user
        // favorites an entity they don't have access to.
        authorizeSpaceAccess(context, spaceId),

        // Bots can't favorite entities
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    return dangerouslyFavoriteSearchEntityWithoutAuthorization(context, {
        spaceId,
        accountId,
        entityId,
    });
}

/**
 * Returns transaction entries to add search entity affinity points to a new entity.
 *
 * Dangerous because it does not check:
 *
 * 1. That the actor is allowed to add affinity for the provided `AccountId`
 * 2. That the actor has access to the provided `SpaceId`
 * 3. That there is an existing affinity entry for the provided `entityId`
 *
 * Use this function when you want to give an entity some initial affinity
 * points without favoriting it, making it show up in the suggested list.
 */
export function dangerouslyAddInitialSearchEntityAffinityWithoutAuthorizationTransactionEntries(
    context: DynamoContext,
    {
        spaceId,
        accountId,
        entityId,
        points,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        entityId: SearchAffinityEntityId;
        points: number;
    },
): Array<DynamoTransactionEntry> {
    const currentTime = Date.now();

    const newEntry = assignSearchAffinityEntityDerivedAttributes({
        partitionType: "Account",
        sortRangeType: "SearchEntityAffinity",
        spaceId,
        accountId,
        entityId,
        points,
        erosion: 0,
        lastUpdatedTime: currentTime,
        favoriteOrderKey: null, // Not favoriting, just adding affinity
    });

    return [SearchEntityTable.transactionDirectlyUpdateItem(newEntry)];
}

/**
 * Adds a search entity to the end of the session actor's favorites list. If
 * the entity is already in the session actor's favorites list then we won't
 * move the entity.
 *
 * Does not check:
 *
 * 1. That the actor is allowed to change favorites for the provided
 *    `AccountId`
 * 2. That the actor has access to the provided `SpaceId`
 *
 * The vast majority of the time you should be calling `favoriteSearchEntity()`
 * which performs authorization. We use this function after adding an account
 * to a space since the actor is never the same account as the account being
 * added.
 */
export async function dangerouslyFavoriteSearchEntityWithoutAuthorization(
    context: DynamoContext,
    {
        spaceId,
        accountId,
        entityId,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        entityId: SearchAffinityEntityId;
    },
): Promise<{orderKey: OrderKey}> {
    const lastFavorites = await arrayFromAsyncIterable(
        AccountSearchFavoriteEntitiesIndex.query(context, {
            partitionKey: {
                spaceId,
                accountId,
            },
            descending: true,
            limit: 1,
        }),
    );

    let orderKey =
        lastFavorites.length > 0
            ? generateOrderKeyBetween(
                  // We should have filtered items out of
                  // `AccountSearchFavoriteEntitiesIndex` that have a null `favoriteOrderKey`.
                  assertExists(lastFavorites[lastFavorites.length - 1]!.favoriteOrderKey),
                  null,
              )
            : initialOrderKey;

    await SearchEntityTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId,
            accountId,
            entityId,
        },
        item => {
            // We've already favorited this item!
            if (typeof item?.favoriteOrderKey === "string") {
                orderKey = item.favoriteOrderKey;
                return item;
            }

            if (item) {
                return assignSearchAffinityEntityDerivedAttributes({
                    ...item,
                    favoriteOrderKey: orderKey,
                });
            }

            return assignSearchAffinityEntityDerivedAttributes({
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId,
                accountId,
                entityId,
                points: 0,
                erosion: 0,
                lastUpdatedTime: Date.now(),
                favoriteOrderKey: orderKey,
            });
        },
    );

    return {orderKey};
}

/**
 * Remove a search entity from the account's favorites list.
 */
export async function unfavoriteSearchEntity(
    context: ServerSessionActionContext,
    {spaceId, entityId}: {spaceId: SpaceId; entityId: SearchAffinityEntityId},
) {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        // Optimization: We don't authorize whether the actor has access to the entity.
        // Since this is a personal favorite list it doesn't really matter if the user
        // favorites an entity they don't have access to.
        authorizeSpaceAccess(context, spaceId),

        // Bots can't favorite entities
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await SearchEntityTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId,
            accountId,
            entityId,
        },
        item => {
            // We've already unfavorited this item!
            if (typeof item?.favoriteOrderKey !== "string") {
                return item;
            }

            return assignSearchAffinityEntityDerivedAttributes({
                ...item,
                favoriteOrderKey: null,
            });
        },
    );
}

/**
 * Move the already favorited search entity to a new `OrderKey`. If the entity
 * is not favorited then this does nothing.
 */
export async function moveSearchFavoriteEntity(
    context: ServerSessionActionContext,
    {
        spaceId,
        entityId,
        orderKey,
    }: {
        spaceId: SpaceId;
        entityId: SearchAffinityEntityId;
        orderKey: OrderKey;
    },
) {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        // Optimization: We don't authorize whether the actor has access to the entity.
        // Since this is a personal favorite list it doesn't really matter if the user
        // favorites an entity they don't have access to.
        authorizeSpaceAccess(context, spaceId),

        // Bots can't favorite entities
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await SearchEntityTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId,
            accountId,
            entityId,
        },
        item => {
            // This item is not favorited!
            if (typeof item?.favoriteOrderKey !== "string") {
                return item;
            }

            return assignSearchAffinityEntityDerivedAttributes({
                ...item,
                favoriteOrderKey: orderKey,
            });
        },
    );
}

/**
 * Is the provided `entityId` one of the session actor's favorites? If we don't
 * have a session actor or the session actor is not a member of the provided
 * `SpaceId` then this always returns false.
 */
export async function isSearchFavoriteEntity(
    context: ServerActionContext,
    {spaceId, entityId}: {spaceId: SpaceId; entityId: SearchAffinityEntityId},
): Promise<boolean> {
    switch (context.actor.type) {
        case "System":
        case "Anonymous":
        case "Bot":
            return false;
        case "Session":
        case "ImpersonatedAccount": {
            if (
                context.actor.type === "ImpersonatedAccount" &&
                context.actor.getSpaceId() !== spaceId
            ) {
                return false;
            }

            if (
                !(await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    context.actor.getAccountId(),
                ))
            ) {
                return false;
            }

            // Optimization: We don't authorize whether the actor has access to the entity.
            // Since this is a personal favorite list it doesn't really matter if the user
            // favorites an entity they don't have access to.

            const item = await SearchEntityTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId,
                accountId: context.actor.getAccountId(),
                entityId,
            });

            return !!item?.favoriteOrderKey;
        }
        default:
            throw exhaustive(context.actor);
    }
}

/**
 * Get an account's favorites in the manually sorted order specified by the
 * user.
 *
 * Labeled "internal" since you should be calling `searchByAffinity()`. This
 * function only returns `SearchAffinityEntityId`s. This function also doesn't filter
 * out entities the account has lost access to! While this function isn't
 * unsafe with regards to permissions (it's fine to know the `SearchAffinityEntityId`
 * of something you used to have access to) it isn't the most convenient
 * function so we label it "internal" but not "dangerous".
 */
export async function internalGetSearchFavoriteEntities(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number | "All"},
): Promise<Array<{entityId: SearchAffinityEntityId; orderKey: OrderKey}>> {
    await authorizeSpaceAccess(context, spaceId);

    return arrayFromAsyncIterable(
        AccountSearchFavoriteEntitiesIndex.query(context, {
            partitionKey: {
                spaceId,
                accountId: context.actor.getAccountId(),
            },
            limit,
        }),
        item => ({
            entityId: item.entityId,
            // The favorites index should filter out all null `favoriteOrderKey`s.
            orderKey: assertExists(item.favoriteOrderKey),
        }),
    );
}
