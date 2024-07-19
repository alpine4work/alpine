import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {prosemirrorToYXmlFragment} from "y-prosemirror";
import * as Y from "yjs";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {OpensearchClientDocWithIdAndVersion} from "~/server/opensearch/opensearch_client.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTaskContextModule} from "~/server/tasks/data/task_context_module.js";
import {getTaskIndexDocIfExistsForTest} from "~/server/tasks/data/task_index.js";
import {TaskIndexActualDoc, TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskEssentialAttributesItem,
    commitTaskActionTransaction,
    getTaskItemForTest,
    updateTaskNotesContent,
} from "~/server/tasks/data/task_table.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";
import {
    TaskTitle,
    TaskTitleProsemirrorSchema,
    TaskTitleUpdate,
    applyTaskTitleUpdate,
    emptyTaskTitle,
    getYDocGuid,
} from "~/shared/tasks/task_title.js";

const schema = TaskNotesContentProsemirrorSchema;

export class TestTask {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: TaskId;
    public readonly createdTime: HybridLogicalTime;

    private readonly _titleState: MutexValue<TaskTitle>;

    private readonly _notesState: MutexValue<{
        lastVersion: number;
        lastUpdatePos: number;
    }>;

    private constructor(
        context: TestContext,
        space: TestSpace,
        id: TaskId,
        createdTime: HybridLogicalTime,
        titleState: MutexValue<TaskTitle>,
    ) {
        this.context = context;
        this.space = space;
        this.id = id;
        this.createdTime = createdTime;
        this._titleState = titleState;
        this._notesState = new MutexValue({lastVersion: 0, lastUpdatePos: 1});
    }

    public static async create(
        session: TestSpaceSession,
        {
            time = testClock.nowLogical(),
            title: titleText = "",
        }: {
            time?: HybridLogicalTime;
            title?: string;
        } = {},
    ) {
        const id = generateId<TaskId>();

        const actions: Array<TaskAction> = [
            {
                type: "UpdateTask",
                time,
                taskId: id,
                taskAction: {
                    type: "Create",
                    creatorId: session.account.id,
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ];

        let titleState: MutexValue<TaskTitle>;

        if (titleText.length === 0) {
            titleState = new MutexValue(emptyTaskTitle.get());
        } else {
            const titleProsemirrorNode = TaskTitleProsemirrorSchema.nodes.doc.create(null, [
                TaskTitleProsemirrorSchema.text(titleText),
            ]);

            const yDoc = new Y.Doc({guid: getYDocGuid()});
            prosemirrorToYXmlFragment(titleProsemirrorNode, yDoc.getXmlFragment("doc"));
            const title = Y.encodeStateAsUpdateV2(yDoc) as TaskTitle;
            yDoc.destroy();

            actions.push({
                type: "UpdateTask",
                time: testClock.nowLogical(),
                taskId: id,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: title,
                },
            });

            titleState = new MutexValue(title);
        }

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, actions);

        return new TestTask(session.context, session.space, id, time, titleState);
    }

    /**
     * Creates an action context for functions like `commitTaskActionTransaction()`
     * which need the task context module.
     */
    public static action(session: TestSession) {
        return session.action().clone({
            tasks: new TestTaskContextModule({
                shouldSkipIndexing: !session.context.isOpensearchEnabled,
                dangerouslyEscalateToSystemContext: session.context.escalateToSystemContext,
            }),
        });
    }

    /**
     * Creates an action including an instance of `TaskContextModuleBase`.
     */
    public static systemAction(space: TestSpace) {
        return space.systemAction().clone({
            tasks: new TestTaskContextModule({
                shouldSkipIndexing: !space.context.isOpensearchEnabled,
                dangerouslyEscalateToSystemContext: space.context.escalateToSystemContext,
            }),
        });
    }

    public getItem(): Promise<TaskEssentialAttributesItem> {
        return getTaskItemForTest(this.context, this.id);
    }

    public async getIndexDocWithVersion(options?: {
        realtime?: boolean;
    }): Promise<OpensearchClientDocWithIdAndVersion<TaskId, TaskIndexActualDoc>> {
        // Wait for any indexing tasks before loading doc...
        await ProcessContextModule.waitForTestTasks();

        const task = await getTaskIndexDocIfExistsForTest(
            this.context,
            this.space.id,
            this.id,
            options,
        );
        if (!task) throw new NotFoundError("Task not found");
        return task;
    }

    public async getIndexDoc(options?: {realtime?: boolean}): Promise<TaskIndexDoc> {
        const {version, approximateActionCountByAccountId, lastIndexSearchEntityJob, ...task} =
            await this.getIndexDocWithVersion(options);

        return task;
    }

    public async delete(session: TestSpaceSession) {
        const time = testClock.nowLogical();

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);
    }

    public async undelete(
        session: TestSpaceSession,
        {time = testClock.nowLogical()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "Undelete",
                },
            },
        ]);
    }

    public async updateStatus(
        session: TestSpaceSession,
        statusType: TaskStatus["type"],
        {time = testClock.nowLogical()}: {time?: HybridLogicalTime} = {},
    ) {
        const status: TaskStatus =
            statusType === "Open"
                ? {type: "Open"}
                : {
                      type: "Closed",
                      closerId: session.account.id,
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
    }

    public async updateAssignee(
        session: TestSpaceSession,
        assignee: TestAccount | TestSession | null,
    ) {
        const time = testClock.nowLogical();

        if (assignee instanceof TestSession) assignee = assignee.account;

        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: assignee
                        ? {
                              assigneeId:
                                  assignee instanceof TestSession
                                      ? assignee.account.id
                                      : assignee.id,
                              assignerId: session.account.id,
                              assignedTime: TaskFilterableTime.test(time),
                          }
                        : null,
                },
            },
        ]);
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
    }

    public async addCollection(
        session: TestSpaceSession,
        collection: TestTaskCollection,
        {time = testClock.nowLogical()}: {time?: HybridLogicalTime} = {},
    ) {
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
    }

    public async updateParentTask(
        session: TestSpaceSession,
        task: TestTask | null,
        {time = testClock.nowLogical()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: task?.id ?? null,
                },
            },
        ]);
    }

    public async updateTitle(session: TestSpaceSession, titleUpdate: TaskTitleUpdate) {
        await this._titleState.withLock(async titleStateRef => {
            titleStateRef.current = applyTaskTitleUpdate(titleStateRef.current, titleUpdate);

            await commitTaskActionTransaction(TestTask.action(session), session.space.id, [
                {
                    type: "UpdateTask",
                    time: testClock.nowLogical(),
                    taskId: this.id,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate,
                    },
                },
            ]);
        });
    }

    public async typeTitle(session: TestSpaceSession, titleUpdateText: string) {
        const yDoc = new Y.Doc({guid: getYDocGuid()});
        Y.applyUpdateV2(yDoc, this._titleState.getWithoutLock());

        const updates: Array<TaskTitleUpdate> = [];

        yDoc.on("updateV2", update => {
            updates.push(update);
        });

        const yXmlFragment = yDoc.getXmlFragment("doc");
        const yText = yXmlFragment.get(yXmlFragment.length - 1);
        assert(yText instanceof Y.XmlText);

        yText.insert(yText.length, titleUpdateText);

        assert(updates.length === 1);
        const titleUpdate = updates[0]!;
        yDoc.destroy();

        await this.updateTitle(session, titleUpdate);
    }

    /**
     * Type new text into the task notes starting from the last updated position in
     * this `TestTask`'s state. Moves the update position to after the new text.
     */
    public async typeNotes(
        session: TestSpaceSession,
        text: string,
        {secondText}: {secondText?: string} = {},
    ) {
        return this._notesState.withLock(async stateRef => {
            const result = await updateTaskNotesContent(session.action(), {
                spaceId: this.space.id,
                taskId: this.id,
                version: stateRef.current.lastVersion,
                steps: [
                    new ReplaceStep(
                        stateRef.current.lastUpdatePos,
                        stateRef.current.lastUpdatePos,
                        text.length !== 0
                            ? new Slice(Fragment.from(schema.text(text)), 0, 0)
                            : Slice.empty,
                    ),
                    ...(secondText !== undefined
                        ? [
                              new ReplaceStep(
                                  stateRef.current.lastUpdatePos + text.length,
                                  stateRef.current.lastUpdatePos + text.length,
                                  secondText.length !== 0
                                      ? new Slice(Fragment.from(schema.text(secondText)), 0, 0)
                                      : Slice.empty,
                              ),
                          ]
                        : []),
                ],
            });

            stateRef.current.lastVersion += 1 + (secondText !== undefined ? 1 : 0);
            stateRef.current.lastUpdatePos +=
                text.length + (secondText !== undefined ? secondText.length : 0);

            return result;
        });
    }
}
