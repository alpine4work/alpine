import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {indexTaskSpaceActionTransactionWithoutCommitForTest} from "~/server/tasks/index/index_task_space_action_transaction.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {taskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_helpers.js";

const context = createTestContext({shouldStartOpensearch: true});

const opensearchClient = new Lazy(() => {
    return new OpensearchClient({
        protocol: "http",
        host: `localhost:${context.getOpensearchLocalPort()}`,
    });
});

const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const otherSpace = createTestSpace(context);

const taskAccount1 = new TaskSortableAccount({
    accountId: session1.accountId,
    workingAccountName: session1.account.name,
});

const clock = new HybridLogicalClock(unsynchronizedSystemClock);

test("can't update task from a different space", async () => {
    const taskId = generateId<TaskId>();

    await indexTaskSpaceActionTransactionWithoutCommitForTest(
        context.systemAction(space.id),
        opensearchClient.get(),
        space.id,
        [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    );

    await expect(
        indexTaskSpaceActionTransactionWithoutCommitForTest(
            context.systemAction(otherSpace.id),
            opensearchClient.get(),
            otherSpace.id,
            [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: taskTitleTestScenario.update0,
                    },
                },
            ],
        ),
    ).rejects.toThrowError(new FailedPreconditionError("Space mismatch"));

    await expect(
        indexTaskSpaceActionTransactionWithoutCommitForTest(
            context.systemAction(otherSpace.id),
            opensearchClient.get(),
            space.id,
            [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: taskTitleTestScenario.update0,
                    },
                },
            ],
        ),
    ).rejects.toThrowError(PermissionDeniedError);

    await indexTaskSpaceActionTransactionWithoutCommitForTest(
        context.systemAction(space.id),
        opensearchClient.get(),
        space.id,
        [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            },
        ],
    );
});

test("can't update collection from a different space", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await indexTaskSpaceActionTransactionWithoutCommitForTest(
        context.systemAction(space.id),
        opensearchClient.get(),
        space.id,
        [
            {
                type: "UpdateTaskCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                },
            },
        ],
    );

    await expect(
        indexTaskSpaceActionTransactionWithoutCommitForTest(
            context.systemAction(otherSpace.id),
            opensearchClient.get(),
            otherSpace.id,
            [
                {
                    type: "UpdateTaskCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "New Collection Name",
                    },
                },
            ],
        ),
    ).rejects.toThrowError(new FailedPreconditionError("Space mismatch"));

    await expect(
        indexTaskSpaceActionTransactionWithoutCommitForTest(
            context.systemAction(otherSpace.id),
            opensearchClient.get(),
            space.id,
            [
                {
                    type: "UpdateTaskCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "New Collection Name",
                    },
                },
            ],
        ),
    ).rejects.toThrowError(PermissionDeniedError);

    await indexTaskSpaceActionTransactionWithoutCommitForTest(
        context.systemAction(space.id),
        opensearchClient.get(),
        space.id,
        [
            {
                type: "UpdateTaskCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    name: "New Collection Name",
                },
            },
        ],
    );
});
