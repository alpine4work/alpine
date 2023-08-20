import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {getTaskIndexDocIfExistsForTest} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc, TaskIndexDocWithVersion} from "~/server/tasks/data/task_index_doc.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/task_table.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";

export class TestTask {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: TaskId;

    private constructor(context: TestContext, space: TestSpace, id: TaskId) {
        this.context = context;
        this.space = space;
        this.id = id;
    }

    public static async create(session: TestSpaceSession) {
        const id = generateId<TaskId>();

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: id,
                taskAction: {
                    type: "Create",
                    creator: TaskSortableAccount.test(session.account),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        return new TestTask(session.context, session.space, id);
    }

    /**
     * Creates an action context for functions like `commitTaskActionTransaction()`
     * which need the task context module.
     */
    public static action(session: TestSpaceSession) {
        return session.action().clone({
            tasks: new TestTaskContextModule({
                shouldSkipIndexing: !session.context.isOpensearchEnabled,
                dangerouslyEscalateToSystemContext: session.context.escalateToSystemContext,
            }),
        });
    }

    public async getIndexDocWithVersion(): Promise<TaskIndexDocWithVersion> {
        // Wait for any indexing tasks before loading doc...
        await ProcessContextModule.waitForTestTasks();

        const task = await getTaskIndexDocIfExistsForTest(this.context, this.space.id, this.id);
        if (!task) throw new NotFoundError("Task not found");
        return task;
    }

    public async getIndexDoc(): Promise<TaskIndexDoc> {
        const {version, ...task} = await this.getIndexDocWithVersion();
        return task;
    }

    public async updateStatus(session: TestSpaceSession, statusType: TaskStatus["type"]) {
        const time = testClock.nowLogical();

        const status: TaskStatus =
            statusType === "Open"
                ? {type: "Open"}
                : {
                      type: "Closed",
                      closer: TaskSortableAccount.test(session),
                      closedTime: TaskFilterableTime.test(time),
                  };

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdateStatus",
                    status,
                },
            },
        ]);

        return this;
    }

    public async updateAssignee(
        session: TestSpaceSession,
        assignee: TestAccount | TestSpaceSession | null,
    ) {
        const time = testClock.nowLogical();

        if (assignee instanceof TestSpaceSession) assignee = assignee.account;

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: assignee
                        ? {
                              assignee: TaskSortableAccount.test(assignee),
                              assigner: TaskSortableAccount.test(session.account),
                              assignedTime: TaskFilterableTime.test(time),
                          }
                        : null,
                },
            },
        ]);

        return this;
    }

    public async updatePriority(
        session: TestSpaceSession,
        priority: TaskPriority | null,
        {time = testClock.nowLogical()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority,
                },
            },
        ]);

        return this;
    }

    public async addCollection(session: TestSpaceSession, collection: TestTaskCollection) {
        const time = testClock.nowLogical();

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collection.id,
                    orderKey: initialOrderKey,
                },
            },
        ]);

        return this;
    }

    public async removeCollection(session: TestSpaceSession, collection: TestTaskCollection) {
        const time = testClock.nowLogical();

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collection.id,
                },
            },
        ]);

        return this;
    }
}
