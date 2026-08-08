import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/data/apply_task_action_to_task_index_doc.js";
import {createEmptyTaskIndexDoc} from "~/server/tasks/data/create_empty_task_index_doc.js";
import {getTaskActivityUpdateFromTaskIndexDocs} from "~/server/tasks/data/get_task_activity_update_from_task_index_docs.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCreateAction, TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";
import {
    createTaskTitleFromText,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

const spaceId = generateId<SpaceId>();
const taskId = generateId<TaskId>();
const creatorId = generateId<AccountId>();
const baseTimeMs = new Date("2026-01-01T12:00:00.000Z").getTime();

function sortableAccount(accountId: AccountId): TaskSortableAccount {
    return {accountId, workingAccountName: "Test Account", workingAccountNameVersion: 0};
}

function updateAction(timeMs: number, taskAction: TaskTaskAction): TaskUpdateTaskAction {
    return {type: "UpdateTask", time: [timeMs, 0], taskId, taskAction};
}

const createTaskAction: TaskCreateAction = {
    type: "Create",
    creator: {accountId: creatorId, from: null},
    creatorTimeZone: defaultTimeZone,
};

function createDoc() {
    return {
        id: taskId,
        spaceId,
        ...createEmptyTaskIndexDoc([baseTimeMs, 0], createTaskAction),
        creator: {...sortableAccount(creatorId), from: null},
    };
}

function applyAction<Task extends ReturnType<typeof createDoc>>(
    doc: Task,
    action: TaskUpdateTaskAction,
): Task {
    return applyTaskActionToTaskIndexDoc(doc, action.time, action.taskAction, sortableAccount);
}

function closedStatus(timeMs: number): TaskStatus {
    return {
        type: "Closed",
        closerId: creatorId,
        closedTime: new TaskFilterableTime({
            absoluteTime: [timeMs, 0],
            setterTimeZone: defaultTimeZone,
        }),
    };
}

test("a create emits without diffing", () => {
    const action = updateAction(baseTimeMs, createTaskAction);

    expect(getTaskActivityUpdateFromTaskIndexDocs(action, null, createDoc())).toEqual({
        type: "TaskCreated",
        actionTime: [baseTimeMs, 0],
    });
});

test("an effective update carries its before and after values", () => {
    const doc = createDoc();
    const action = updateAction(baseTimeMs + 1, {type: "UpdatePriority", priority: "High"});

    expect(getTaskActivityUpdateFromTaskIndexDocs(action, doc, applyAction(doc, action))).toEqual({
        type: "TaskPriorityUpdated",
        actionTime: [baseTimeMs + 1, 0],
        previousPriority: null,
        priority: "High",
    });
});

test("a noop fallback carries the action\u2019s intended value without an initial value", () => {
    const winner = updateAction(baseTimeMs + 2, {type: "UpdatePriority", priority: "High"});
    const docAfterWinner = applyAction(createDoc(), winner);
    const loser = updateAction(baseTimeMs + 1, {type: "UpdatePriority", priority: "Low"});

    expect(
        getTaskActivityUpdateFromTaskIndexDocs(
            loser,
            docAfterWinner,
            applyAction(docAfterWinner, loser),
        ),
    ).toEqual({
        type: "TaskPriorityUpdated",
        actionTime: [baseTimeMs + 1, 0],
        priority: "Low",
    });
});

test("an effective title update returns an unversioned title window payload", () => {
    const doc = createDoc();
    const action = updateAction(baseTimeMs + 1, {
        type: "UpdateTitle",
        titleUpdate: createTaskTitleFromText(randomlyGenerateTaskTitleClientId(), "Fix login"),
    });

    expect(getTaskActivityUpdateFromTaskIndexDocs(action, doc, applyAction(doc, action))).toEqual({
        type: "TitleWindow",
        beforeTitleText: "",
        afterTitleText: "Fix login",
        actionTime: [baseTimeMs + 1, 0],
    });
});

test("a title update noop returns null", () => {
    const action = updateAction(baseTimeMs + 1, {
        type: "UpdateTitle",
        titleUpdate: createTaskTitleFromText(randomlyGenerateTaskTitleClientId(), "Fix login"),
    });
    const docAfter = applyAction(createDoc(), action);

    expect(
        getTaskActivityUpdateFromTaskIndexDocs(action, docAfter, applyAction(docAfter, action)),
    ).toBeNull();
});

test("a losing close still reports a closed status", () => {
    const winner = updateAction(baseTimeMs + 2, {
        type: "UpdateStatus",
        status: closedStatus(baseTimeMs + 2),
    });
    const docClosed = applyAction(createDoc(), winner);
    const loser = updateAction(baseTimeMs + 1, {
        type: "UpdateStatus",
        status: closedStatus(baseTimeMs + 1),
    });

    expect(
        getTaskActivityUpdateFromTaskIndexDocs(loser, docClosed, applyAction(docClosed, loser)),
    ).toEqual({
        type: "TaskStatusUpdated",
        actionTime: [baseTimeMs + 1, 0],
        statusType: "Closed",
    });
});

test("an ambiguous status noop returns null", () => {
    const doc = createDoc();
    // Activating the assignee status of an unassigned task leaves the display status
    // OpenInactive, and an activation's intended display value isn't derivable from
    // the action alone.
    const action = updateAction(baseTimeMs + 1, {
        type: "UpdateAssigneeStatus",
        assigneeStatus: {
            type: "Active",
            activatedTime: TaskFilterableTime.test([baseTimeMs + 1, 0]),
        },
    });

    expect(
        getTaskActivityUpdateFromTaskIndexDocs(action, doc, applyAction(doc, action)),
    ).toBeNull();
});

test("a closed task\u2019s assignee status noop returns null", () => {
    const assigneeId = generateId<AccountId>();
    const setup = [
        updateAction(baseTimeMs + 1, {
            type: "UpdateAssignee",
            assignee: {
                assigneeId,
                assignerId: creatorId,
                assignedTime: TaskFilterableTime.test([baseTimeMs + 1, 0]),
            },
        }),
        updateAction(baseTimeMs + 2, {type: "UpdateStatus", status: closedStatus(baseTimeMs + 2)}),
    ];
    const docClosed = setup.reduce(applyAction, createDoc());
    // Marking a closed task's assignee status active is the My Tasks section-move
    // gesture: personal bookkeeping with no display effect (Closed → Closed). It must
    // never leak a feed entry.
    const action = updateAction(baseTimeMs + 3, {
        type: "UpdateAssigneeStatus",
        assigneeStatus: {
            type: "Active",
            activatedTime: TaskFilterableTime.test([baseTimeMs + 3, 0]),
        },
    });

    expect(
        getTaskActivityUpdateFromTaskIndexDocs(action, docClosed, applyAction(docClosed, action)),
    ).toBeNull();
});
