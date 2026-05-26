import {CalendarDate} from "@internationalized/date";
import {Fragment, Node, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {TestAccessPolicy} from "~/server/access/test_helpers/test_access_policy.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {attachFileAsUploader} from "~/server/files/data/files_actions.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestCommentRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {OpensearchClientDocWithIdAndVersion} from "~/server/opensearch/opensearch_client.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {
    TestAccountActionContext,
    TestBotActionContext,
    TestContext,
    TestSessionActionContext,
} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {getTaskIndexDocIfExistsForTest} from "~/server/tasks/data/task_index.js";
import {TaskIndexActualDoc, TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    FileTaskAuthorizer,
    TaskEssentialAttributesItem,
    commitTaskActionTransaction,
    completeTaskCommentStream,
    createTaskComment,
    deleteTaskComment,
    deleteTaskCommentReaction,
    getTaskComment,
    getTaskItemForTest,
    putTaskCommentStreamPart,
    setTaskCommentReaction,
    updateTaskCommentContent,
    updateTaskNotesContent,
} from "~/server/tasks/data/task_table.js";
import {testTaskClock} from "~/server/tasks/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {fromApiContentBlockElements} from "~/shared/api/content/from_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateOrderKeysBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, FileId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {
    MessageContentPayloadParent,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {createDefaultTaskAccessPolicy} from "~/shared/tasks/create_default_task_access_policy.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";
import {
    TaskTitle,
    TaskTitleModel,
    TaskTitleUpdate,
    applyTaskTitleUpdate,
    createTaskTitleFromText,
    emptyTaskTitle,
} from "~/shared/tasks/title/task_title.js";

const schema = TaskNotesContentProsemirrorSchema;

export class TestTask extends TestCommentRoomBase {
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
        notesState: MutexValue<{lastVersion: number; lastUpdatePos: number}>,
    ) {
        super();
        this.context = context;
        this.space = space;
        this.id = id;
        this.createdTime = createdTime;
        this._titleState = titleState;
        this._notesState = notesState;
    }

    public static async create(
        session: TestSpaceSession,
        {
            id = generateId<TaskId>(),
            time,
            status: statusType,
            title: titleText = "",
            parent,
            assignee,
            assigneeStatus,
            priority,
            layout,
            dueDate,
            collections,
            notes = "",
        }: {
            id?: TaskId;
            time?: HybridLogicalTime;
            status?: TaskStatus["type"];
            title?: string;
            parent?: TestTask;
            assignee?: TestAccount | TestSession | null;
            assigneeStatus?: "Inactive" | "Active";
            priority?: TaskPriority;
            layout?: TaskLayout | null;
            dueDate?: CalendarDate | null;
            collections?: TestTaskCollection | ReadonlyArray<TestTaskCollection>;
            notes?: string;
        } = {},
    ) {
        if (time) {
            testTaskClock.tick(time);
        } else {
            time = testTaskClock.now();
        }

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

        if (statusType) {
            const status: TaskStatus =
                statusType === "Open"
                    ? {type: "Open"}
                    : {
                          type: "Closed",
                          closerId: session.account.id,
                          closedTime: TaskFilterableTime.test(time),
                      };

            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: id,
                taskAction: {
                    type: "UpdateStatus",
                    status,
                },
            });
        }

        let titleState: MutexValue<TaskTitle>;

        if (titleText.length === 0) {
            titleState = new MutexValue(emptyTaskTitle.get());
        } else {
            const title = createTaskTitleFromText(titleText);

            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: id,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: title,
                },
            });

            titleState = new MutexValue(title);
        }

        if (parent) {
            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: id,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: parent.id,
                },
            });
        }

        if (assignee) {
            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: id,
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
            });
        }

        if (assigneeStatus) {
            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: id,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus:
                        assigneeStatus === "Active"
                            ? {type: "Active", activatedTime: TaskFilterableTime.test(time)}
                            : {type: assigneeStatus},
                },
            });
        }

        if (priority) {
            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: id,
                taskAction: {
                    type: "UpdatePriority",
                    priority,
                },
            });
        }

        if (layout !== undefined) {
            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: id,
                taskAction: {
                    type: "UpdateLayout",
                    layout,
                },
            });
        }

        if (dueDate) {
            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId: id,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate,
                },
            });
        }

        if (collections) {
            const collectionsArray = isReadonlyArray(collections) ? collections : [collections];
            const orderKeys = generateOrderKeysBetween(null, null, collectionsArray.length);

            for (let i = 0; i < collectionsArray.length; i++) {
                actions.push({
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: id,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collectionsArray[i]!.id,
                        orderKey: orderKeys[i]!,
                    },
                });
            }
        }

        await commitTaskActionTransaction(session.action(), session.space.id, actions);

        let notesState;

        if (notes.length === 0) {
            notesState = new MutexValue({lastVersion: 0, lastUpdatePos: 1});
        } else {
            const fragment = Fragment.from(parseTaskTestContent(session.space.id, notes));

            await updateTaskNotesContent(session.action(), {
                spaceId: session.space.id,
                taskId: id,
                version: 0,
                steps: [new ReplaceStep(0, 2, new Slice(fragment, 0, 0))],
            });

            notesState = new MutexValue({lastVersion: 1, lastUpdatePos: fragment.size - 1});
        }

        return new TestTask(session.context, session.space, id, time, titleState, notesState);
    }

    public readonly access = new TestAccessPolicy({
        get: async () => {
            const item = await this.getItem();
            return item.accessPolicy?.value ?? createDefaultTaskAccessPolicy(item.creatorId);
        },
        set: async (session, accessPolicy) => {
            await commitTaskActionTransaction(session.action(), session.space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
                    taskId: this.id,
                    taskAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy,
                    },
                },
            ]);
        },
    });

    protected override _getRoomKey() {
        return this.id;
    }

    public override getBotScope(): BotTokenPayloadScope {
        return {type: "Task", taskId: this.id};
    }

    public override _getMessage(context: TestSessionActionContext, messageIndex: number) {
        return getTaskComment(context, {
            taskId: this.id,
            commentIndex: messageIndex,
        });
    }

    protected override _createMessage(
        context: TestAccountActionContext,
        {
            parent,
            content,
            fileIds,
            createdTimeZone,
            overrideCreatedTime,
            isStream,
        }: {
            parent: MessageContentPayloadParent | null;
            content: MessageContent;
            fileIds: ReadonlyArray<FileId>;
            createdTimeZone?: TimeZone;
            overrideCreatedTime?: Date;
            isStream?: boolean;
        },
    ) {
        return createTaskComment(context, {
            taskId: this.id,
            parent,
            content,
            fileIds,
            isStream,
            createdTimeZone: createdTimeZone ?? defaultTimeZone,
            overrideCreatedTimeForTest: overrideCreatedTime,
        });
    }

    public override _updateMessageContent(
        context: TestSessionActionContext,
        {
            messageIndex,
            contentVersion,
            steps,
        }: {
            messageIndex: number;
            contentVersion: number;
            steps: ReadonlyArray<Step>;
        },
    ) {
        return updateTaskCommentContent(context, {
            taskId: this.id,
            commentIndex: messageIndex,
            contentVersion,
            steps,
        });
    }

    public override _deleteMessage(
        context: TestSessionActionContext,
        {messageIndex}: {messageIndex: number},
    ) {
        return deleteTaskComment(context, {
            taskId: this.id,
            commentIndex: messageIndex,
        });
    }

    public override async _putMessageStreamPart(
        context: TestBotActionContext,
        {
            messageIndex,
            partIndex,
            payload,
        }: {
            messageIndex: number;
            partIndex: number;
            payload: MessageStreamPartPayload;
        },
    ) {
        await putTaskCommentStreamPart(context, {
            taskId: this.id,
            commentIndex: messageIndex,
            partIndex,
            payload,
        });
    }

    public override async _completeMessageStream(
        context: TestBotActionContext,
        {messageIndex}: {messageIndex: number},
    ) {
        await completeTaskCommentStream(context, {
            taskId: this.id,
            commentIndex: messageIndex,
        });
    }

    public override async _setMessageReaction(
        context: ServerSessionActionContextWithPush,
        {
            messageIndex,
            contentVersion,
            pos,
            reaction,
        }: {
            messageIndex: number;
            contentVersion: number;
            pos: number | "Files";
            reaction: Reaction | "GenericLike";
        },
    ) {
        await setTaskCommentReaction(context, {
            taskId: this.id,
            commentIndex: messageIndex,
            contentVersion,
            pos,
            reaction,
        });
    }

    public override async _deleteMessageReaction(
        context: ServerSessionActionContext,
        {
            messageIndex,
            contentVersion,
            pos,
        }: {
            messageIndex: number;
            contentVersion: number;
            pos: number | "Files";
        },
    ) {
        await deleteTaskCommentReaction(context, {
            taskId: this.id,
            commentIndex: messageIndex,
            contentVersion,
            pos,
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
        const time = testTaskClock.now();

        await commitTaskActionTransaction(session.action(), session.space.id, [
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
        {time = testTaskClock.now()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
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
        {time = testTaskClock.now()}: {time?: HybridLogicalTime} = {},
    ) {
        const status: TaskStatus =
            statusType === "Open"
                ? {type: "Open"}
                : {
                      type: "Closed",
                      closerId: session.account.id,
                      closedTime: TaskFilterableTime.test(time),
                  };

        await commitTaskActionTransaction(session.action(), session.space.id, [
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

        return {time};
    }

    public async updateAssignee(
        session: TestSpaceSession,
        assignee: TestAccount | TestSession | AccountId | null,
        {assigneeStatus}: {assigneeStatus?: "Inactive" | "Active"} = {},
    ) {
        const time = testTaskClock.now();

        if (typeof assignee === "string") assignee = await TestAccount.get(this.context, assignee);
        else if (assignee instanceof TestSession) assignee = assignee.account;

        await commitTaskActionTransaction(session.action(), session.space.id, [
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
                    assigneeStatus:
                        assigneeStatus !== undefined
                            ? assigneeStatus === "Active"
                                ? {type: "Active", activatedTime: TaskFilterableTime.test(time)}
                                : {type: assigneeStatus}
                            : undefined,
                },
            },
        ]);

        return {time};
    }

    public async updateAssigneeStatus(
        session: TestSpaceSession,
        assigneeStatus: "Inactive" | "Active",
    ) {
        const time = testTaskClock.now();

        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus:
                        assigneeStatus === "Active"
                            ? {type: "Active", activatedTime: TaskFilterableTime.test(time)}
                            : {type: assigneeStatus},
                },
            },
        ]);
    }

    public async updatePriority(
        session: TestSpaceSession,
        priority: TaskPriority | null,
        {time = testTaskClock.now()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
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

    public async updateLayout(
        session: TestSpaceSession,
        layout: TaskLayout | null,
        {time = testTaskClock.now()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdateLayout",
                    layout,
                },
            },
        ]);
    }

    public async updateDueDate(
        session: TestSpaceSession,
        dueDate: CalendarDate | null,
        {time = testTaskClock.now()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate,
                },
            },
        ]);
    }

    public async addCollection(
        session: TestSpaceSession,
        collection: TestTaskCollection,
        {time = testTaskClock.now()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
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

        return {time};
    }

    public async updateCollectionPosition(
        session: TestSpaceSession,
        collection: TestTaskCollection,
        position: TaskPosition,
        {time = testTaskClock.now()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdateCollectionPosition",
                    collectionId: collection.id,
                    position,
                },
            },
        ]);

        return {time};
    }

    public async removeCollection(session: TestSpaceSession, collection: TestTaskCollection) {
        const time = testTaskClock.now();

        await commitTaskActionTransaction(session.action(), session.space.id, [
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
        {time = testTaskClock.now()}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
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

            await commitTaskActionTransaction(session.action(), session.space.id, [
                {
                    type: "UpdateTask",
                    time: testTaskClock.now(),
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
        const title = new TaskTitleModel(this._titleState.getWithoutLock());

        const pos = title.getText().length;
        const titleUpdate = title.replace(pos, pos, titleUpdateText);

        await this.updateTitle(session, titleUpdate.raw);
    }

    /**
     * Type new text into the task notes starting from the last updated position in
     * this `TestTask`'s state. Moves the update position to after the new text.
     */
    public async typeNotes(
        session: TestSpaceSession,
        text: string | Node | ReadonlyArray<Node> | Fragment,
        {secondText}: {secondText?: string} = {},
    ) {
        return await this._notesState.withLock(async stateRef => {
            if (typeof text === "string") {
                if (text.length === 0) text = Fragment.empty;
                else text = Fragment.from(schema.text(text));
            }

            if (text instanceof Node) text = [text];
            if (isReadonlyArray(text)) text = Fragment.from(text);

            const result = await updateTaskNotesContent(session.action(), {
                spaceId: this.space.id,
                taskId: this.id,
                version: stateRef.current.lastVersion,
                steps: [
                    new ReplaceStep(
                        stateRef.current.lastUpdatePos,
                        stateRef.current.lastUpdatePos,
                        text.size !== 0 ? new Slice(text, 0, 0) : Slice.empty,
                    ),
                    ...(secondText !== undefined
                        ? [
                              new ReplaceStep(
                                  stateRef.current.lastUpdatePos + text.size,
                                  stateRef.current.lastUpdatePos + text.size,
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
                text.size + (secondText !== undefined ? secondText.length : 0);

            return result;
        });
    }

    /**
     * Attach a file to the task's notes. Will attach the file as a block immediately
     * below the current typing position.
     */
    public async attachFile(session: TestSpaceSession, file: TestFile) {
        await attachFileAsUploader(
            session.action(),
            file.id,
            FileTaskAuthorizer.bind({type: "TaskNotes", taskId: this.id}),
        );

        await this._notesState.withLock(async stateRef => {
            const steps = [
                new ReplaceStep(
                    stateRef.current.lastUpdatePos + 1,
                    stateRef.current.lastUpdatePos + 1,
                    new Slice(
                        Fragment.from(
                            schema.node("fileRow", {}, schema.node("file", {fileId: file.id})),
                        ),
                        0,
                        0,
                    ),
                ),
            ];

            await updateTaskNotesContent(session.action(), {
                spaceId: this.space.id,
                taskId: this.id,
                version: stateRef.current.lastVersion,
                steps,
            });

            stateRef.current.lastVersion += steps.length;
        });
    }
}

function parseTaskTestContent(spaceId: SpaceId, content: string) {
    const apiContent = parseApiContentFromMarkdown(content, {spaceId});

    return Array.from(
        fromApiContentBlockElements(TaskNotesContentProsemirrorSchema, apiContent.elements),
    );
}
