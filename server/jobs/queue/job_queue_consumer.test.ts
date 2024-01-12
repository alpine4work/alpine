import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {
    JobQueueConsumer,
    changeMessageVisibilityBatchTestCounter,
    deleteMessageBatchTestCounter,
    receiveMessageTestCounter,
} from "~/server/jobs/queue/job_queue_consumer.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Id, generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

let consumer: JobQueueConsumer | null = null;

let receiveMessageRecorder: {getCount: () => number};
let deleteMessageBatchRecorder: {getCount: () => number};
let changeMessageVisibilityBatchRecorder: {getCount: () => number};

const processTestJobDescriptionTestCheckpoint = new TestCheckpoint<Id>();

beforeEach(async () => {
    // We have to restart our local SQS server between every test because our local
    // implementation continues to handle `ReceiveMessage` calls even if they were
    // aborted (and they're aborted after a `stop()` call).
    await context.restartSqsLocal();

    assert(consumer === null);

    receiveMessageRecorder = receiveMessageTestCounter.recordForTest();
    deleteMessageBatchRecorder = deleteMessageBatchTestCounter.recordForTest();
    changeMessageVisibilityBatchRecorder = changeMessageVisibilityBatchTestCounter.recordForTest();

    consumer = JobQueueConsumer.start(context, {
        region: "us-east-1",
        queueUrl: `http://localhost:${context.getSqsLocalPort()}/local/JobQueue`,
        processJob: async (context, job) => {
            switch (job.type) {
                case "Test": {
                    await processTestJobDescriptionTestCheckpoint.waitForTest(job.checkpointId);
                    return;
                }
                default:
                    throw new UnimplementedError("Unimplemented job");
            }
        },
        processMaintenanceJob: async (context, job) => {
            throw new UnimplementedError("Unimplemented maintenance job");
        },
    });
});

afterEach(() => {
    assert(consumer !== null);

    consumer.stop();
    consumer = null;
});

// Important for this to come after the `afterEach()` above. Since we want to
// stop our consumer before waiting on `ProcessContextModule` tasks.
const context = createTestContext({shouldSendJobsToSqs: true});

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

    // Also flushes any batched jobs instead of waiting 200ms.
    await context.jobs.sendImmediately({type: "Test", spaceId, checkpointId: job15Id});

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

    for (let i = 0; i < 202; i++) {
        const jobId = generateId();
        pausePromises.push(
            PromiseImmediate.resolve(processTestJobDescriptionTestCheckpoint.pauseForTest(jobId)),
        );
        if (i < 201) {
            context.jobs.send({type: "Test", spaceId, checkpointId: jobId});
        } else {
            await context.jobs.sendImmediately({type: "Test", spaceId, checkpointId: jobId});
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
    await context.jobs.sendImmediately({type: "Test", spaceId, checkpointId: jobId});

    await pausePromise;

    expect(receiveMessageRecorder.getCount()).toEqual(oldReceiveMessageCount + 1);
    expect(deleteMessageBatchRecorder.getCount()).toEqual(oldDeleteMessageBatchCount);
    expect(changeMessageVisibilityBatchRecorder.getCount()).toEqual(0);
});
