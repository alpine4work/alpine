import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    JobQueueConsumer,
    changeMessageVisibilityBatchTestCounter,
    deleteMessageBatchTestCounter,
    receiveMessageTestCounter,
} from "~/server/jobs/queue/consumer/job_queue_consumer.js";
import {TestContextModules} from "~/server/spaces/test_helpers/test_context.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {Id, generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

// We have to use real timers in this test because we want to test timing behavior
// in SQS as well. Our local SQS implementation doesn't have fake timers. This may
// make the test inherently flaky. Feel free to retry this test a couple times if
// it fails.
import.meta.jest.useRealTimers();

let consumer: JobQueueConsumer<"Default", TestContextModules>;

let receiveMessageRecorder: {getCount: () => number};
let deleteMessageBatchRecorder: {getCount: () => number};
let changeMessageVisibilityBatchRecorder: {getCount: () => number};

const processTestJobDescriptionTestCheckpoint = new TestCheckpoint<Id>();
const stopTestJobCheckpointIdsFromThrowing = new Set<Id>();

beforeEach(async () => {
    // We have to restart our local SQS server between every test because our local
    // implementation continues to handle `ReceiveMessage` calls even if they were
    // aborted (and they're aborted after a `stop()` call).
    await context.restartSqsLocal();

    assert(consumer === undefined);

    receiveMessageRecorder = receiveMessageTestCounter.recordForTest();
    deleteMessageBatchRecorder = deleteMessageBatchTestCounter.recordForTest();
    changeMessageVisibilityBatchRecorder = changeMessageVisibilityBatchTestCounter.recordForTest();

    consumer = JobQueueConsumer.start(context, {
        region: "us-east-1",
        queueName: "Default",
        queueUrl: `http://localhost:${context.getSqsLocalPort()}/local/JobQueue`,
        maxFiberCount: 10,
        maxFiberMessageCount: 10,
        processJob: async (context, job) => {
            switch (job.type) {
                case "Test": {
                    await processTestJobDescriptionTestCheckpoint.waitForTest(job.checkpointId);

                    if (
                        job.shouldThrow &&
                        !stopTestJobCheckpointIdsFromThrowing.has(job.checkpointId)
                    ) {
                        throw new InternalError("Test job failed");
                    }
                    return;
                }
                default:
                    throw new UnimplementedError("Unimplemented job");
            }
        },
        processMaintenanceJob: async () => {
            throw new UnimplementedError("Unimplemented maintenance job");
        },
    });
});

afterEach(async () => {
    assert(consumer !== undefined);

    await consumer.stop();
    // @ts-expect-error
    consumer = undefined;

    stopTestJobCheckpointIdsFromThrowing.clear();

    receiveMessageTestCounter.resetForTest();
    deleteMessageBatchTestCounter.resetForTest();
    changeMessageVisibilityBatchTestCounter.resetForTest();
});

// Important for this to come after the `afterEach()` above. Since we want to stop
// our consumer before waiting on `ProcessContextModule` tasks.
const context = createTestContext({shouldSendJobsToSqs: true});

test(
    "if a job fails it will be retried",
    async () => {
        const spaceId = generateId<SpaceId>();

        const job1Id = generateId();
        const job2Id = generateId();
        const job3Id = generateId();

        const pause1aPromise = processTestJobDescriptionTestCheckpoint.pauseForTest(job1Id);
        const pause2aPromise = processTestJobDescriptionTestCheckpoint.pauseForTest(job2Id);
        const pause3aPromise = processTestJobDescriptionTestCheckpoint.pauseForTest(job3Id);

        context.jobs.send({type: "Test", spaceId, checkpointId: job1Id, shouldThrow: true});
        context.jobs.send({type: "Test", spaceId, checkpointId: job2Id});

        await context.jobs.sendAndWait({
            type: "Test",
            spaceId,
            checkpointId: job3Id,
            shouldThrow: true,
        });

        const {unpause: unpause1a, stopPausing: stopPausing1a} = await pause1aPromise;
        const {unpause: unpause2a, stopPausing: stopPausing2a} = await pause2aPromise;
        const {unpause: unpause3a, stopPausing: stopPausing3a} = await pause3aPromise;

        expect(receiveMessageRecorder.getCount()).toBeGreaterThanOrEqual(1);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(0);
        expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);

        stopPausing1a();
        stopPausing2a();
        stopPausing3a();

        const pause1bPromise = processTestJobDescriptionTestCheckpoint.pauseForTest(job1Id);
        const pause3bPromise = processTestJobDescriptionTestCheckpoint.pauseForTest(job3Id);

        unpause1a();
        unpause2a();
        unpause3a();

        const {unpause: unpause1b, stopPausing: stopPausing1b} = await pause1bPromise;
        const {unpause: unpause3b, stopPausing: stopPausing3b} = await pause3bPromise;

        expect(receiveMessageRecorder.getCount()).toBeGreaterThanOrEqual(2);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(1);
        expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);

        stopTestJobCheckpointIdsFromThrowing.add(job3Id);

        stopPausing1b();
        stopPausing3b();

        const pause1cPromise = processTestJobDescriptionTestCheckpoint.pauseForTest(job1Id);

        unpause1b();
        unpause3b();

        const {unpause: unpause1c} = await pause1cPromise;

        expect(receiveMessageRecorder.getCount()).toBeGreaterThanOrEqual(3);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(2);
        expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);

        stopTestJobCheckpointIdsFromThrowing.add(job1Id);

        unpause1c();

        await waitMacrotask();

        expect(receiveMessageRecorder.getCount()).toBeGreaterThanOrEqual(3);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(3);
        expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);
    },
    // Increase the timeout since we need to actually wait for the job queue message
    // visibility timeouts.
    30 * 1000,
);

test(
    "if a job takes a while to process it\u2019s message visibility will be updated",
    async () => {
        const spaceId = generateId<SpaceId>();

        const job1Id = generateId();
        const job2Id = generateId();
        const job3Id = generateId();

        const pause1aPromise = processTestJobDescriptionTestCheckpoint.pauseForTest(job1Id);
        const pause2Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job2Id);
        const pause3Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job3Id);

        context.jobs.send({type: "Test", spaceId, checkpointId: job1Id, shouldThrow: true});
        context.jobs.send({type: "Test", spaceId, checkpointId: job2Id});

        await context.jobs.sendAndWait({type: "Test", spaceId, checkpointId: job3Id});

        const {unpause: unpause1a, stopPausing: stopPausing1a} = await pause1aPromise;
        const {unpause: unpause2} = await pause2Promise;
        const {unpause: unpause3} = await pause3Promise;

        stopPausing1a();

        const pause1bPromise = processTestJobDescriptionTestCheckpoint.pauseForTest(job1Id);

        const receiveMessageCount1 = receiveMessageRecorder.getCount();

        expect(receiveMessageRecorder.getCount()).toEqual(receiveMessageCount1);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(0);
        expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);

        unpause2();

        await wait(100);

        expect(receiveMessageCount1).toBeGreaterThanOrEqual(1);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(0);
        expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);

        await wait(1500);

        const changeMessageVisibilityBatchCount1 = changeMessageVisibilityBatchRecorder.getCount();

        expect(receiveMessageRecorder.getCount()).toEqual(receiveMessageCount1);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(1);
        expect(changeMessageVisibilityBatchCount1).toBeGreaterThanOrEqual(1);

        await wait(1500);

        const changeMessageVisibilityBatchCount2 = changeMessageVisibilityBatchRecorder.getCount();

        expect(receiveMessageRecorder.getCount()).toEqual(receiveMessageCount1);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(1);
        expect(changeMessageVisibilityBatchCount2).toBeGreaterThanOrEqual(
            changeMessageVisibilityBatchCount1 + 1,
        );

        unpause3();

        await wait(100);

        expect(receiveMessageRecorder.getCount()).toEqual(receiveMessageCount1);
        expect(deleteMessageBatchRecorder.getCount()).toBeGreaterThanOrEqual(1);
        expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(
            changeMessageVisibilityBatchCount2,
        );

        await wait(1400);

        const changeMessageVisibilityBatchCount3 = changeMessageVisibilityBatchRecorder.getCount();

        expect(receiveMessageRecorder.getCount()).toEqual(receiveMessageCount1);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(2);
        expect(changeMessageVisibilityBatchCount3).toBeGreaterThanOrEqual(
            changeMessageVisibilityBatchCount2 + 1,
        );

        unpause1a();

        await pause1bPromise;

        expect(receiveMessageRecorder.getCount()).toBeGreaterThanOrEqual(receiveMessageCount1 + 1);
        expect(deleteMessageBatchRecorder.getCount()).toEqual(2);
        expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(
            changeMessageVisibilityBatchCount3,
        );
    },
    // Increase the timeout since we need to actually wait for the job queue message
    // visibility timeouts.
    45 * 1000,
);

test("starts processing new jobs immediately after receiving first batch", async () => {
    const spaceId = generateId<SpaceId>();

    const job1Id = generateId();
    const job2Id = generateId();
    const job3Id = generateId();
    const job4Id = generateId();
    const job5Id = generateId();
    const job6Id = generateId();
    const job7Id = generateId();
    const job8Id = generateId();
    const job9Id = generateId();
    const job10Id = generateId();
    const job11Id = generateId();
    const job12Id = generateId();
    const job13Id = generateId();
    const job14Id = generateId();
    const job15Id = generateId();

    const pause1Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job1Id);
    const pause2Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job2Id);
    const pause3Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job3Id);
    const pause4Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job4Id);
    const pause5Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job5Id);
    const pause6Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job6Id);
    const pause7Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job7Id);
    const pause8Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job8Id);
    const pause9Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job9Id);
    const pause10Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job10Id);
    const pause11Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job11Id);
    const pause12Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job12Id);
    const pause13Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job13Id);
    const pause14Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job14Id);
    const pause15Promise = processTestJobDescriptionTestCheckpoint.pauseForTest(job15Id);

    context.jobs.send({type: "Test", spaceId, checkpointId: job1Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job2Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job3Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job4Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job5Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job6Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job7Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job8Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job9Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job10Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job11Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job12Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job13Id});
    context.jobs.send({type: "Test", spaceId, checkpointId: job14Id});

    await context.jobs.sendAndWait({type: "Test", spaceId, checkpointId: job15Id});

    // The consumer sees job 15 even before job 1 resolves.
    await pause1Promise;
    await pause15Promise;

    expect(receiveMessageRecorder.getCount()).toBeGreaterThanOrEqual(2);
    expect(deleteMessageBatchRecorder.getCount()).toEqual(0);
    expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);

    await runAllPromises(
        [
            pause1Promise,
            pause2Promise,
            pause3Promise,
            pause4Promise,
            pause5Promise,
            pause6Promise,
            pause7Promise,
            pause8Promise,
            pause9Promise,
            pause10Promise,
            pause11Promise,
            pause12Promise,
            pause13Promise,
            pause14Promise,
        ].map(async pausePromise => {
            (await pausePromise).unpause();
        }),
    );

    const deleteMessageBatchCount1 = deleteMessageBatchRecorder.getCount();

    (await pause15Promise).unpause();

    await waitMacrotask();

    expect(receiveMessageRecorder.getCount()).toBeGreaterThanOrEqual(2);
    expect(deleteMessageBatchRecorder.getCount()).toBeGreaterThan(deleteMessageBatchCount1);
    expect(deleteMessageBatchRecorder.getCount()).toBeGreaterThanOrEqual(2);
    expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);
});

test("will max out at 10 receive message calls at a time then scale back down to 1 at a time", async () => {
    const spaceId = generateId<SpaceId>();

    const pausePromises: Array<PromiseImmediate<{unpause: () => void}>> = [];

    const jobCount = 202;

    for (let i = 0; i < jobCount; i++) {
        const jobId = generateId();
        pausePromises.push(
            PromiseImmediate.resolve(processTestJobDescriptionTestCheckpoint.pauseForTest(jobId)),
        );
        if (i < jobCount - 1) {
            context.jobs.send({type: "Test", spaceId, checkpointId: jobId});
        } else {
            await context.jobs.sendAndWait({type: "Test", spaceId, checkpointId: jobId});
        }
    }

    const waitForConsumer = async () => {
        const resolvedPromiseCount1 = pausePromises.reduce(
            (count, pausePromise) => count + (!pausePromise.isPending() ? 1 : 0),
            0,
        );

        await wait(200);

        const resolvedPromiseCount2 = pausePromises.reduce(
            (count, pausePromise) => count + (!pausePromise.isPending() ? 1 : 0),
            0,
        );

        if (resolvedPromiseCount1 !== resolvedPromiseCount2) {
            await waitForConsumer();
        }
    };

    await waitForConsumer();

    const resolvedPromiseCount1 = pausePromises.reduce(
        (count, pausePromise) => count + (!pausePromise.isPending() ? 1 : 0),
        0,
    );

    expect(resolvedPromiseCount1).toBeLessThanOrEqual(100);
    expect(receiveMessageRecorder.getCount()).toEqual(10);
    expect(deleteMessageBatchRecorder.getCount()).toEqual(0);
    expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);

    for (const pausePromise of pausePromises) {
        if (!pausePromise.isPending()) {
            pausePromise.getOrThrow().unpause();
        }
    }

    await waitForConsumer();

    const resolvedPromiseCount2 = pausePromises.reduce(
        (count, pausePromise) => count + (!pausePromise.isPending() ? 1 : 0),
        0,
    );

    expect(resolvedPromiseCount2).toBeGreaterThan(resolvedPromiseCount1);
    expect(receiveMessageRecorder.getCount()).toEqual(20);
    expect(deleteMessageBatchRecorder.getCount()).toBeGreaterThanOrEqual(1);
    expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);

    await runAllPromises(
        pausePromises.map(async pausePromise => {
            (await pausePromise).unpause();
        }),
    );

    await waitMacrotask();

    const oldReceiveMessageCount = receiveMessageRecorder.getCount();
    const oldDeleteMessageBatchCount = deleteMessageBatchRecorder.getCount();

    const jobId = generateId();
    const pausePromise = processTestJobDescriptionTestCheckpoint.pauseForTest(jobId);
    await context.jobs.sendAndWait({type: "Test", spaceId, checkpointId: jobId});

    await pausePromise;

    expect(receiveMessageRecorder.getCount()).toEqual(oldReceiveMessageCount + 1);
    expect(deleteMessageBatchRecorder.getCount()).toEqual(oldDeleteMessageBatchCount);
    expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);
});

test("can schedule external fibers that stop jobs from being processed", async () => {
    const spaceId = generateId<SpaceId>();

    const sendJobsSequentially = async (jobCount: number) => {
        const pauses: Array<{unpause: () => void}> = [];

        for (let i = 0; i < jobCount; i++) {
            const jobId = generateId();
            const pausePromise = processTestJobDescriptionTestCheckpoint.pauseForTest(jobId);
            await context.jobs.sendAndWait({type: "Test", spaceId, checkpointId: jobId});
            pauses.push(await pausePromise);
        }

        return pauses;
    };

    const sendJobsConcurrentlyWithoutWaiting = async (jobCount: number) => {
        const pausePromises: Array<PromiseImmediate<{unpause: () => void}>> = [];

        for (let i = 0; i < jobCount; i++) {
            const jobId = generateId();
            pausePromises.push(
                PromiseImmediate.resolve(
                    processTestJobDescriptionTestCheckpoint.pauseForTest(jobId),
                ),
            );
            if (i < jobCount - 1) {
                context.jobs.send({type: "Test", spaceId, checkpointId: jobId});
            } else {
                await context.jobs.sendAndWait({type: "Test", spaceId, checkpointId: jobId});
            }
        }

        return pausePromises;
    };

    expect(receiveMessageRecorder.getCount()).toEqual(1);
    await sendJobsSequentially(3);
    expect(receiveMessageRecorder.getCount()).toEqual(4);

    const actionPromiseResolver1a = createPromiseResolver();
    const actionPromiseResolver1b = createPromiseResolver();
    void consumer.withFiber(context, () => {
        actionPromiseResolver1b.resolve();
        return actionPromiseResolver1a.promise;
    });
    expect(actionPromiseResolver1b.isSettled()).toBe(true);

    const actionPromiseResolver2a = createPromiseResolver();
    const actionPromiseResolver2b = createPromiseResolver();
    void consumer.withFiber(context, () => {
        actionPromiseResolver2b.resolve();
        return actionPromiseResolver2a.promise;
    });
    expect(actionPromiseResolver2b.isSettled()).toBe(true);

    expect(receiveMessageRecorder.getCount()).toEqual(4);
    const pauses2 = await sendJobsSequentially(2);
    expect(receiveMessageRecorder.getCount()).toEqual(6);

    const actionPromiseResolver3a = createPromiseResolver();
    const actionPromiseResolver3b = createPromiseResolver();
    void consumer
        .withFiber(context, () => {
            actionPromiseResolver3b.resolve();
            return actionPromiseResolver3a.promise;
        })
        .catch(() => {});
    expect(actionPromiseResolver3b.isSettled()).toBe(true);

    expect(receiveMessageRecorder.getCount()).toEqual(6);
    const pauses3 = await sendJobsSequentially(1);
    expect(receiveMessageRecorder.getCount()).toEqual(7);
    await sendJobsSequentially(1);
    expect(receiveMessageRecorder.getCount()).toEqual(7);

    const pausePromises5 = await sendJobsConcurrentlyWithoutWaiting(50);

    await wait(200);

    expect(receiveMessageRecorder.getCount()).toEqual(7);
    expect(pausePromises5.every(pausePromise => pausePromise.isPending())).toBe(true);

    pauses2[0]!.unpause();

    await Promise.race(pausePromises5.filter(pausePromise => pausePromise.isPending()));

    expect(receiveMessageRecorder.getCount()).toEqual(8);
    expect(!pausePromises5.every(pausePromise => pausePromise.isPending())).toBe(true);
    expect(!pausePromises5.every(pausePromise => !pausePromise.isPending())).toBe(true);

    actionPromiseResolver2a.resolve();

    await Promise.race(pausePromises5.filter(pausePromise => pausePromise.isPending()));

    expect(receiveMessageRecorder.getCount()).toEqual(9);
    expect(!pausePromises5.every(pausePromise => pausePromise.isPending())).toBe(true);
    expect(!pausePromises5.every(pausePromise => !pausePromise.isPending())).toBe(true);

    const actionPromiseResolver4a = createPromiseResolver();
    const actionPromiseResolver4b = createPromiseResolver();
    void consumer.withFiber(context, () => {
        actionPromiseResolver4b.resolve();
        return actionPromiseResolver4a.promise;
    });
    expect(actionPromiseResolver4b.isSettled()).toBe(false);

    const actionPromiseResolver5a = createPromiseResolver();
    const actionPromiseResolver5b = createPromiseResolver();
    void consumer.withFiber(context, () => {
        actionPromiseResolver5b.resolve();
        return actionPromiseResolver5a.promise;
    });
    expect(actionPromiseResolver5b.isSettled()).toBe(false);

    pauses3[0]!.unpause();

    await actionPromiseResolver4b.promise;

    expect(receiveMessageRecorder.getCount()).toEqual(9);
    expect(!pausePromises5.every(pausePromise => pausePromise.isPending())).toBe(true);
    expect(!pausePromises5.every(pausePromise => !pausePromise.isPending())).toBe(true);

    expect(actionPromiseResolver4b.isSettled()).toBe(true);
    expect(actionPromiseResolver5b.isSettled()).toBe(false);

    actionPromiseResolver3a.reject(new InternalError("Test"));

    await actionPromiseResolver5b.promise;

    expect(receiveMessageRecorder.getCount()).toEqual(9);
    expect(!pausePromises5.every(pausePromise => pausePromise.isPending())).toBe(true);
    expect(!pausePromises5.every(pausePromise => !pausePromise.isPending())).toBe(true);

    expect(actionPromiseResolver4b.isSettled()).toBe(true);
    expect(actionPromiseResolver5b.isSettled()).toBe(true);

    actionPromiseResolver5a.resolve();

    await Promise.race(pausePromises5.filter(pausePromise => pausePromise.isPending()));

    expect(receiveMessageRecorder.getCount()).toEqual(10);
    expect(!pausePromises5.every(pausePromise => pausePromise.isPending())).toBe(true);
    expect(!pausePromises5.every(pausePromise => !pausePromise.isPending())).toBe(true);
});

test("can interrupt receive message call with external fibers", async () => {
    const spaceId = generateId<SpaceId>();

    const sendJobsSequentially = async (jobCount: number) => {
        const pauses: Array<{unpause: () => void}> = [];

        for (let i = 0; i < jobCount; i++) {
            const jobId = generateId();
            const pausePromise = processTestJobDescriptionTestCheckpoint.pauseForTest(jobId);
            await context.jobs.sendAndWait({type: "Test", spaceId, checkpointId: jobId});
            pauses.push(await pausePromise);
        }

        return pauses;
    };

    const sendJobsConcurrentlyWithoutWaiting = async (jobCount: number) => {
        const pausePromises: Array<PromiseImmediate<{unpause: () => void}>> = [];

        for (let i = 0; i < jobCount; i++) {
            const jobId = generateId();
            pausePromises.push(
                PromiseImmediate.resolve(
                    processTestJobDescriptionTestCheckpoint.pauseForTest(jobId),
                ),
            );
            if (i < jobCount - 1) {
                context.jobs.send({type: "Test", spaceId, checkpointId: jobId});
            } else {
                await context.jobs.sendAndWait({type: "Test", spaceId, checkpointId: jobId});
            }
        }

        return pausePromises;
    };

    expect(receiveMessageRecorder.getCount()).toEqual(1);
    await sendJobsSequentially(3);
    expect(receiveMessageRecorder.getCount()).toEqual(4);

    expect(receiveMessageRecorder.getCount()).toEqual(4);
    await sendJobsSequentially(3);
    expect(receiveMessageRecorder.getCount()).toEqual(7);

    expect(receiveMessageRecorder.getCount()).toEqual(7);
    await sendJobsSequentially(3);
    expect(receiveMessageRecorder.getCount()).toEqual(10);

    const actionPromiseResolver1a = createPromiseResolver();
    const actionPromiseResolver1b = createPromiseResolver();
    void consumer.withFiber(context, () => {
        actionPromiseResolver1b.resolve();
        return actionPromiseResolver1a.promise;
    });

    await actionPromiseResolver1b.promise;

    expect(receiveMessageRecorder.getCount()).toEqual(10);

    const pausePromises = await sendJobsConcurrentlyWithoutWaiting(1);

    await wait(200);

    expect(receiveMessageRecorder.getCount()).toEqual(10);
    expect(pausePromises.every(pausePromise => pausePromise.isPending())).toBe(true);
});
