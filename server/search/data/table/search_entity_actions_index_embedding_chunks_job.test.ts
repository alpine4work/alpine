import {addMinutes, addSeconds, subMinutes, subSeconds} from "date-fns";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {IndexSearchEntityEmbeddingChunksJobDescription} from "~/server/search/core/index_search_entity_job_description.js";
import {SearchEntityTable} from "~/server/search/data/table/internal/search_entity_table.js";
import {
    createWithIndexSearchEntityEmbeddingChunksJobLockSimulatedCrashErrorForTest,
    scheduleIndexSearchEntityEmbeddingChunksJob,
    withIndexSearchEntityEmbeddingChunksJobLock,
    withIndexSearchEntityEmbeddingChunksJobLockIntervalPromiseWaiterForTest,
} from "~/server/search/data/table/search_entity_actions.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {
    PromiseResolver,
    createPromiseResolver,
} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";

// Increase test timeout since we're seeing this test have some flaky timeouts.
import.meta.jest.setTimeout(1000 * 30);

import.meta.jest.useFakeTimers();

let processJobCount = 1;
beforeEach(() => {
    processJobCount = 1;
});

let jobs: Array<{
    description: IndexSearchEntityEmbeddingChunksJobDescription;
    actionPromise: Promise<{promiseResolver: PromiseResolver<void> | null}>;
    promise: Promise<void>;
}> = [];

const allJobActionPromises: Array<Promise<{promiseResolver: PromiseResolver<void> | null}>> = [];

function takeJob() {
    return assertExists(jobs.shift(), "Expected a job but no jobs exist");
}

function takeJobIfExists() {
    return jobs.shift() ?? null;
}

afterEach(async () => {
    const jobActions = await runAllPromises(allJobActionPromises);

    for (const action of jobActions) {
        action.promiseResolver?.resolve();
    }

    jobs = [];
});

const context = createTestContext({
    processJob: async (context, job) => {
        if (job.type === "IndexSearchEntityEmbeddingChunks") {
            await runAllPromises(
                createArrayWithLength(processJobCount, async () => {
                    const actionPromiseResolver = createPromiseResolver<{
                        promiseResolver: PromiseResolver<void> | null;
                    }>();

                    const promise = (async () => {
                        await assertExists(
                            withIndexSearchEntityEmbeddingChunksJobLockIntervalPromiseWaiterForTest,
                        ).wait();

                        await withIndexSearchEntityEmbeddingChunksJobLock(
                            context,
                            job,
                            async () => {
                                assert(!actionPromiseResolver.isSettled());
                                const promiseResolver = createPromiseResolver();
                                actionPromiseResolver.resolve({promiseResolver});
                                await promiseResolver.promise;
                            },
                        );

                        if (!actionPromiseResolver.isSettled()) {
                            actionPromiseResolver.resolve({promiseResolver: null});
                        }
                    })();

                    jobs.push({
                        description: job,
                        actionPromise: actionPromiseResolver.promise,
                        promise,
                    });
                    allJobActionPromises.push(actionPromiseResolver.promise);

                    await promise;
                }),
            );
        }
    },
});

function generateSearchEntityId(): SearchDynamicEntityId {
    return `Document:${generateId<DocumentId>()}`;
}

async function getIndexSearchEntityEmbeddingChunksJobState(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    {
        spaceId,
        entityId,
    }: {
        spaceId: SpaceId;
        entityId: SearchDynamicEntityId;
    },
) {
    return await SearchEntityTable.getItem(context, {
        partitionType: "IndexSearchEntityEmbeddingChunksJob",
        sortRangeType: "State",
        spaceId,
        entityId,
    });
}

test("should schedule a job with 5-minute delay", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();
    const readAfterTime = new Date();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime,
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job = takeJob();

    expect(job.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const jobAction = await job.actionPromise;
    jobAction.promiseResolver?.resolve();
    await job.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("should only schedule one job when scheduling within a 5-minute window", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();
    const readAfterTime = new Date();

    await runAllPromises([
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime,
            forceMetadataUpdate: false,
        }),
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime,
            forceMetadataUpdate: false,
        }),
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime,
            forceMetadataUpdate: false,
        }),
    ]);

    await runAllPromises([
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime: addSeconds(readAfterTime, 45),
            forceMetadataUpdate: false,
        }),
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime: subSeconds(readAfterTime, 45),
            forceMetadataUpdate: false,
        }),
    ]);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job = takeJob();

    expect(job.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const jobAction = await job.actionPromise;
    jobAction.promiseResolver?.resolve();
    await job.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("will schedule a new job after 5-minute window", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job1 = takeJob();

    expect(job1.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job1Action = await job1.actionPromise;
    job1Action.promiseResolver?.resolve();
    await job1.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job2 = takeJob();

    expect(job2.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job2Action = await job2.actionPromise;
    job2Action.promiseResolver?.resolve();
    await job2.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    const readAfterTime = new Date(Date.now());

    await runAllPromises([
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime,
            forceMetadataUpdate: false,
        }),
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime,
            forceMetadataUpdate: false,
        }),
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime,
            forceMetadataUpdate: false,
        }),
    ]);

    await runAllPromises([
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime: addSeconds(readAfterTime, 45),
            forceMetadataUpdate: false,
        }),
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime: subSeconds(readAfterTime, 45),
            forceMetadataUpdate: false,
        }),
    ]);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job3 = takeJob();

    expect(job3.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job3Action = await job3.actionPromise;
    job3Action.promiseResolver?.resolve();
    await job3.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("shouldn\u2019t schedule job when previous job already processed the entity update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job1 = takeJob();
    const job1Action = await job1.actionPromise;
    job1Action.promiseResolver?.resolve();
    await job1.promise;

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subSeconds(new Date(), 10),
        forceMetadataUpdate: false,
    });

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    // Simulate SQS retrying the failed job. The job hasn't actually failed in this
    // case, but we want to test the inverse of our error scenario tested below. This
    // may actually happen in certain SQS retry scenarios.
    await context.jobs.sendAndWait(job1.description);

    const job2 = takeJob();
    const job2Action = await job2.actionPromise;
    expect(job2Action.promiseResolver).toEqual(null);

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("shouldn\u2019t schedule job when previous job already processed the entity update and failed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job1 = takeJob();
    const job1Action = await job1.actionPromise;

    const error = new InternalError("Uh oh!");
    expect(job1Action.promiseResolver).not.toEqual(null);
    job1Action.promiseResolver?.reject(error);

    try {
        await job1.promise;
    } catch (caughtError) {
        if (caughtError !== error) throw error;
    }
    try {
        await ProcessContextModule.waitForTestTasks();
    } catch (caughtError) {
        if (caughtError !== error) throw error;
    }

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subSeconds(new Date(), 10),
        forceMetadataUpdate: false,
    });

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    // Simulate SQS retrying the failed job. We should actually execute the retried
    // job's action.
    await context.jobs.sendAndWait(job1.description);

    const job2 = takeJob();
    const job2Action = await job2.actionPromise;
    expect(job2Action.promiseResolver).not.toEqual(null);
    job2Action.promiseResolver?.resolve();
    await job2.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("shouldn\u2019t schedule job when active job is processing the entity update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job = takeJob();
    const jobAction = await job.actionPromise;

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subSeconds(new Date(), 10),
        forceMetadataUpdate: false,
    });

    jobAction.promiseResolver?.resolve();
    await job.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("force metadata update schedules after previous false job but not after previous true job", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job1 = takeJob();
    expect(job1.description.forceMetadataUpdate).toEqual(false);
    const job1Action = await job1.actionPromise;
    job1Action.promiseResolver?.resolve();
    await job1.promise;

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subSeconds(new Date(), 10),
        forceMetadataUpdate: true,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job2 = takeJob();
    expect(job2.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
        forceMetadataUpdate: true,
    });
    const job2Action = await job2.actionPromise;
    job2Action.promiseResolver?.resolve();
    await job2.promise;

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subSeconds(new Date(), 10),
        forceMetadataUpdate: true,
    });

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
});

test("force metadata update schedules with scheduled false job but not with scheduled true job", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();
    const readAfterTimeForFalseJob = new Date();
    const readAfterTimeForTrueJob = addMinutes(readAfterTimeForFalseJob, 4);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: readAfterTimeForFalseJob,
        forceMetadataUpdate: false,
    });

    const jobState1 = await getIndexSearchEntityEmbeddingChunksJobState(context, {
        spaceId: space.id,
        entityId,
    });

    expect(jobState1?.scheduledJobs).toHaveLength(1);
    expect(jobState1?.scheduledJobs[0]?.forceMetadataUpdate).toEqual(false);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: readAfterTimeForTrueJob,
        forceMetadataUpdate: true,
    });

    const jobState2 = await getIndexSearchEntityEmbeddingChunksJobState(context, {
        spaceId: space.id,
        entityId,
    });

    expect(jobState2?.scheduledJobs).toHaveLength(2);
    expect(jobState2?.scheduledJobs.filter(job => job.forceMetadataUpdate)).toHaveLength(1);
    expect(jobState2?.scheduledJobs.filter(job => !job.forceMetadataUpdate)).toHaveLength(1);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: readAfterTimeForTrueJob,
        forceMetadataUpdate: true,
    });

    const jobState3 = await getIndexSearchEntityEmbeddingChunksJobState(context, {
        spaceId: space.id,
        entityId,
    });

    expect(jobState3?.scheduledJobs).toHaveLength(2);
    expect(jobState3?.scheduledJobs.filter(job => job.forceMetadataUpdate)).toHaveLength(1);
    expect(jobState3?.scheduledJobs.filter(job => !job.forceMetadataUpdate)).toHaveLength(1);

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job1 = takeJob();
    expect(job1.description.forceMetadataUpdate).toEqual(false);
    const job1Action = await job1.actionPromise;
    job1Action.promiseResolver?.resolve();
    await job1.promise;

    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);

    const job2 = takeJob();
    expect(job2.description.forceMetadataUpdate).toEqual(true);
    const job2Action = await job2.actionPromise;
    job2Action.promiseResolver?.resolve();
    await job2.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
});

test("force metadata update schedules with active false job but not with active true job", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const entityId1 = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId: entityId1,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job1 = takeJob();
    expect(job1.description.forceMetadataUpdate).toEqual(false);
    const job1Action = await job1.actionPromise;
    expect(job1Action.promiseResolver).not.toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId: entityId1,
        readAfterTime: subSeconds(new Date(), 10),
        forceMetadataUpdate: true,
    });

    const jobState1 = await getIndexSearchEntityEmbeddingChunksJobState(context, {
        spaceId: space.id,
        entityId: entityId1,
    });
    expect(jobState1?.scheduledJobs.filter(job => job.forceMetadataUpdate)).toHaveLength(1);

    job1Action.promiseResolver?.resolve();
    await job1.promise;

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job2 = takeJob();
    expect(job2.description.forceMetadataUpdate).toEqual(true);
    const job2Action = await job2.actionPromise;
    job2Action.promiseResolver?.resolve();
    await job2.promise;

    const entityId2 = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId: entityId2,
        readAfterTime: new Date(),
        forceMetadataUpdate: true,
    });

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job3 = takeJob();
    expect(job3.description.forceMetadataUpdate).toEqual(true);
    const job3Action = await job3.actionPromise;
    expect(job3Action.promiseResolver).not.toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId: entityId2,
        readAfterTime: subSeconds(new Date(), 10),
        forceMetadataUpdate: true,
    });

    const jobState2 = await getIndexSearchEntityEmbeddingChunksJobState(context, {
        spaceId: space.id,
        entityId: entityId2,
    });
    expect(jobState2?.scheduledJobs).toHaveLength(0);

    job3Action.promiseResolver?.resolve();
    await job3.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
});

test("concurrent schedule false and true keeps a true job that executes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();
    const readAfterTimeForTrueJob = new Date();
    const readAfterTimeForFalseJob = addMinutes(readAfterTimeForTrueJob, 10);

    await runAllPromises([
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime: readAfterTimeForFalseJob,
            forceMetadataUpdate: false,
        }),
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime: readAfterTimeForTrueJob,
            forceMetadataUpdate: true,
        }),
    ]);

    const jobState = await getIndexSearchEntityEmbeddingChunksJobState(context, {
        spaceId: space.id,
        entityId,
    });

    expect(jobState?.scheduledJobs).toHaveLength(2);
    expect(jobState?.scheduledJobs.filter(job => job.forceMetadataUpdate)).toHaveLength(1);
    expect(jobState?.scheduledJobs.filter(job => !job.forceMetadataUpdate)).toHaveLength(1);
    expect(jobState?.activeJob).toEqual(null);

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const trueJob = takeJob();
    expect(trueJob.description.forceMetadataUpdate).toEqual(true);
    expect(takeJobIfExists()).toEqual(null);
    const trueJobAction = await trueJob.actionPromise;
    expect(trueJobAction.promiseResolver).not.toEqual(null);
    trueJobAction.promiseResolver?.resolve();
    await trueJob.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    const falseJob = takeJob();
    expect(falseJob.description.forceMetadataUpdate).toEqual(false);
    expect(takeJobIfExists()).toEqual(null);
    const falseJobAction = await falseJob.actionPromise;
    expect(falseJobAction.promiseResolver).not.toEqual(null);
    falseJobAction.promiseResolver?.resolve();
    await falseJob.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
});

test("concurrent schedule true and true dedupes to a single true job", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();
    const readAfterTime = new Date();

    await runAllPromises([
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime,
            forceMetadataUpdate: true,
        }),
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime,
            forceMetadataUpdate: true,
        }),
    ]);

    const jobState = await getIndexSearchEntityEmbeddingChunksJobState(context, {
        spaceId: space.id,
        entityId,
    });

    expect(jobState?.scheduledJobs).toHaveLength(1);
    expect(jobState?.scheduledJobs[0]?.forceMetadataUpdate).toEqual(true);

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job = takeJob();
    expect(job.description.forceMetadataUpdate).toEqual(true);
    const jobAction = await job.actionPromise;
    expect(jobAction.promiseResolver).not.toEqual(null);
    jobAction.promiseResolver?.resolve();
    await job.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
});

test("rescheduled lock-contention retries preserve force metadata update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const activeJob = takeJob();
    expect(activeJob.description.forceMetadataUpdate).toEqual(false);
    const activeJobAction = await activeJob.actionPromise;
    expect(activeJobAction.promiseResolver).not.toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subMinutes(new Date(), 6),
        forceMetadataUpdate: true,
    });

    const rescheduledJob = takeJob();
    expect(rescheduledJob.description.forceMetadataUpdate).toEqual(true);

    const rescheduledJobAction = await rescheduledJob.actionPromise;
    expect(rescheduledJobAction.promiseResolver).toEqual(null);

    activeJobAction.promiseResolver?.resolve();
    await activeJob.promise;

    import.meta.jest.advanceTimersByTime(3 * 60 * 1000 + 15 * 1000 + 1);

    const retriedJob = takeJob();
    expect(retriedJob.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: rescheduledJob.description.id,
        spaceId: space.id,
        entityId,
        forceMetadataUpdate: true,
    });

    const retriedJobAction = await retriedJob.actionPromise;
    expect(retriedJobAction.promiseResolver).not.toEqual(null);
    retriedJobAction.promiseResolver?.resolve();
    await retriedJob.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
});

test("concurrent jobs on different entities should run independently", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId1 = generateSearchEntityId();
    const entityId2 = generateSearchEntityId();

    await runAllPromises([
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId: entityId1,
            readAfterTime: new Date(),
            forceMetadataUpdate: false,
        }),
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId: entityId2,
            readAfterTime: new Date(),
            forceMetadataUpdate: false,
        }),
    ]);

    import.meta.jest.advanceTimersByTime(5 * 60 * 1000);

    const job1 = takeJob();
    const job2 = takeJob();
    expect(takeJobIfExists()).toEqual(null);

    const job1Action = await job1.actionPromise;
    const job2Action = await job2.actionPromise;

    job1Action.promiseResolver?.resolve();
    job2Action.promiseResolver?.resolve();

    await job1.promise;
    await job2.promise;
});

test("should schedule a job looking to read a far past entity update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subMinutes(new Date(), 30),
        forceMetadataUpdate: false,
    });

    const job = takeJob();

    expect(job.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const jobAction = await job.actionPromise;
    jobAction.promiseResolver?.resolve();
    await job.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("should schedule a job looking to read a near past entity update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subMinutes(new Date(), 2),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(2 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job = takeJob();

    expect(job.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const jobAction = await job.actionPromise;
    jobAction.promiseResolver?.resolve();
    await job.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("shouldn\u2019t schedule a job looking to read a far future entity update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await expect(
        scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
            spaceId: space.id,
            entityId,
            readAfterTime: addMinutes(new Date(), 30),
            forceMetadataUpdate: false,
        }),
    ).rejects.toThrow(InternalError);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("job is prevented from running twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job1 = takeJob();
    expect(takeJobIfExists()).toEqual(null);

    expect(job1.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job1Action = await job1.actionPromise;

    // Simulate SQS trying to execute the same job a second time. SQS provides
    // at-least-once delivery semantics so we need to test the same message being
    // delivered more than once.
    await context.jobs.sendAndWait(job1.description);

    const job2 = takeJob();
    expect(takeJobIfExists()).toEqual(null);

    expect(job2.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job1.description.id,
        spaceId: space.id,
        entityId,
    });

    const job2Action = await job2.actionPromise;

    expect(job1Action.promiseResolver).not.toEqual(null);
    expect(job2Action.promiseResolver).toEqual(null);

    job1Action.promiseResolver?.resolve();
    await job1.promise;
});

test("job is prevented from running multiple times in race condition", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    // Will run the same job multiple times in parallel. Simulating SQS trying to
    // execute a job multiple times simultaneously.
    processJobCount = 4;

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job1 = takeJob();
    const job2 = takeJob();
    const job3 = takeJob();
    const job4 = takeJob();
    expect(takeJobIfExists()).toEqual(null);

    expect(job2.description.id).toEqual(job1.description.id);
    expect(job3.description.id).toEqual(job1.description.id);
    expect(job4.description.id).toEqual(job1.description.id);

    const [job1Action, job2Action, job3Action, job4Action] = await runAllPromises([
        job1.actionPromise,
        job2.actionPromise,
        job3.actionPromise,
        job4.actionPromise,
    ]);

    let nullPromiseResolverCount = 0;
    if (job1Action.promiseResolver === null) nullPromiseResolverCount++;
    if (job2Action.promiseResolver === null) nullPromiseResolverCount++;
    if (job3Action.promiseResolver === null) nullPromiseResolverCount++;
    if (job4Action.promiseResolver === null) nullPromiseResolverCount++;

    expect(nullPromiseResolverCount).toEqual(3);
});

test("reschedules a job that tries to run too soon after the previous job", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job1 = takeJob();

    expect(job1.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job1Action = await job1.actionPromise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(job1Action.promiseResolver).not.toEqual(null);
    job1Action.promiseResolver?.resolve();
    await job1.promise;

    // We need to wait 3 minutes between jobs for the OpenSearch index to refresh.
    // Since our actual indexing action will need to read previously written data from
    // the OpenSearch index.
    import.meta.jest.advanceTimersByTime(2 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subMinutes(new Date(), 6),
        forceMetadataUpdate: false,
    });

    const job2 = takeJob();

    expect(job2.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });
    expect(job2.description.id).not.toEqual(job1.description.id);

    const job2Action = await job2.actionPromise;
    expect(job2Action.promiseResolver).toEqual(null);

    import.meta.jest.advanceTimersByTime(0.5 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(0.5 * 60 * 1000 + 1);

    const job3 = takeJob();

    expect(job3.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job3Action = await job3.actionPromise;
    expect(job3Action.promiseResolver).not.toEqual(null);
    job3Action.promiseResolver?.resolve();
    await job3.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("reschedules a job that tries to run too soon after the previous failed job", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job1 = takeJob();

    expect(job1.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job1Action = await job1.actionPromise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    const error = new InternalError("Uh oh!");
    expect(job1Action.promiseResolver).not.toEqual(null);
    job1Action.promiseResolver?.reject(error);

    try {
        await job1.promise;
    } catch (caughtError) {
        if (caughtError !== error) throw error;
    }
    try {
        await ProcessContextModule.waitForTestTasks();
    } catch (caughtError) {
        if (caughtError !== error) throw error;
    }

    // We need to wait 3 minutes between jobs for the OpenSearch index to refresh.
    // Since our actual indexing action will need to read previously written data from
    // the OpenSearch index.
    import.meta.jest.advanceTimersByTime(2 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subMinutes(new Date(), 6),
        forceMetadataUpdate: false,
    });

    const job2 = takeJob();

    expect(job2.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });
    expect(job2.description.id).not.toEqual(job1.description.id);

    const job2Action = await job2.actionPromise;
    expect(job2Action.promiseResolver).toEqual(null);

    import.meta.jest.advanceTimersByTime(0.5 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(0.5 * 60 * 1000 + 1);

    const job3 = takeJob();

    expect(job3.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job3Action = await job3.actionPromise;
    expect(job3Action.promiseResolver).not.toEqual(null);
    job3Action.promiseResolver?.resolve();
    await job3.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("reschedules a job that runs just enough time after the previous job", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000 + 1);

    const job1 = takeJob();

    expect(job1.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job1Action = await job1.actionPromise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(job1Action.promiseResolver).not.toEqual(null);
    job1Action.promiseResolver?.resolve();
    await job1.promise;

    // We need to wait 3 minutes between jobs for the OpenSearch index to refresh.
    // Since our actual indexing action will need to read previously written data from
    // the OpenSearch index.
    import.meta.jest.advanceTimersByTime(3 * 60 * 1000 + 1);

    expect(takeJobIfExists()).toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: subMinutes(new Date(), 6),
        forceMetadataUpdate: false,
    });

    const job2 = takeJob();

    expect(job2.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });
    expect(job2.description.id).not.toEqual(job1.description.id);

    const job2Action = await job2.actionPromise;
    expect(job2Action.promiseResolver).not.toEqual(null);
    job2Action.promiseResolver?.resolve();
    await job2.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);
});

test("keeps rescheduling new jobs if there\u2019s an existing long running job", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job1 = takeJob();

    expect(job1.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job1Action = await job1.actionPromise;
    expect(job1Action.promiseResolver).not.toEqual(null);

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job2 = takeJob();

    expect(job2.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });
    expect(job2.description.id).not.toEqual(job1.description.id);

    const job2Action = await job2.actionPromise;
    expect(job2Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(3 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000);

    const job3 = takeJob();

    expect(job3.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job3Action = await job3.actionPromise;
    expect(job3Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(3 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000);

    const job4 = takeJob();

    expect(job4.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job4Action = await job4.actionPromise;
    expect(job4Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(2 * 60 * 1000);

    job1Action.promiseResolver?.resolve();
    await job1.promise;

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000);

    const job5 = takeJob();

    expect(job5.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job5Action = await job5.actionPromise;
    expect(job5Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime((1 * 60 - 15) * 1000 + 1);

    const job6 = takeJob();

    expect(job6.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job6Action = await job6.actionPromise;
    expect(job6Action.promiseResolver).not.toEqual(null);
    job6Action.promiseResolver?.resolve();
    await job6.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
});

test("keeps rescheduling new jobs if there\u2019s an existing long running job (with error)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000 + 1);

    const job1 = takeJob();

    expect(job1.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job1Action = await job1.actionPromise;
    expect(job1Action.promiseResolver).not.toEqual(null);

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job2 = takeJob();

    expect(job2.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });
    expect(job2.description.id).not.toEqual(job1.description.id);

    const job2Action = await job2.actionPromise;
    expect(job2Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(3 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000);

    const job3 = takeJob();

    expect(job3.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job3Action = await job3.actionPromise;
    expect(job3Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(3 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000);

    const job4 = takeJob();

    expect(job4.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job4Action = await job4.actionPromise;
    expect(job4Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(2 * 60 * 1000);

    const error = new InternalError("Uh oh!");
    expect(job1Action.promiseResolver).not.toEqual(null);
    job1Action.promiseResolver?.reject(error);

    try {
        await job1.promise;
    } catch (caughtError) {
        if (caughtError !== error) throw error;
    }
    try {
        await ProcessContextModule.waitForTestTasks();
    } catch (caughtError) {
        if (caughtError !== error) throw error;
    }

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000);

    const job5 = takeJob();

    expect(job5.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job5Action = await job5.actionPromise;
    expect(job5Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime((1 * 60 - 15) * 1000 + 1);

    const job6 = takeJob();

    expect(job6.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job6Action = await job6.actionPromise;
    expect(job6Action.promiseResolver).not.toEqual(null);
    job6Action.promiseResolver?.resolve();
    await job6.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
});

test("keeps rescheduling new jobs if there\u2019s an existing long running job (with simulated crash)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const entityId = generateSearchEntityId();

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job1 = takeJob();

    expect(job1.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });

    const job1Action = await job1.actionPromise;
    expect(job1Action.promiseResolver).not.toEqual(null);

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);

    expect(takeJobIfExists()).toEqual(null);

    await scheduleIndexSearchEntityEmbeddingChunksJob(session.action(), {
        spaceId: space.id,
        entityId,
        readAfterTime: new Date(),
        forceMetadataUpdate: false,
    });

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(4 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);

    const job2 = takeJob();

    expect(job2.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: expect.any(String),
        spaceId: space.id,
        entityId,
    });
    expect(job2.description.id).not.toEqual(job1.description.id);

    const job2Action = await job2.actionPromise;
    expect(job2Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(3 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000);

    const job3 = takeJob();

    expect(job3.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job3Action = await job3.actionPromise;
    expect(job3Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(3 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000);

    const job4 = takeJob();

    expect(job4.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job4Action = await job4.actionPromise;
    expect(job4Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(2 * 60 * 1000);

    const error = createWithIndexSearchEntityEmbeddingChunksJobLockSimulatedCrashErrorForTest();
    expect(job1Action.promiseResolver).not.toEqual(null);
    job1Action.promiseResolver?.reject(error);

    try {
        await job1.promise;
    } catch (caughtError) {
        if (caughtError !== error) throw error;
    }
    try {
        await ProcessContextModule.waitForTestTasks();
    } catch (caughtError) {
        if (caughtError !== error) throw error;
    }

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000);

    const job5 = takeJob();

    expect(job5.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job5Action = await job5.actionPromise;
    expect(job5Action.promiseResolver).toEqual(null);

    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime((1 * 60 - 15) * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(14 * 1000);
    expect(takeJobIfExists()).toEqual(null);
    import.meta.jest.advanceTimersByTime(1 * 1000 + 1);

    const job6 = takeJob();

    expect(job6.description).toMatchObject({
        type: "IndexSearchEntityEmbeddingChunks",
        id: job2.description.id,
        spaceId: space.id,
        entityId,
    });

    const job6Action = await job6.actionPromise;
    expect(job6Action.promiseResolver).not.toEqual(null);
    job6Action.promiseResolver?.resolve();
    await job6.promise;

    import.meta.jest.advanceTimersByTime(10 * 60 * 1000);
    expect(takeJobIfExists()).toEqual(null);
});
