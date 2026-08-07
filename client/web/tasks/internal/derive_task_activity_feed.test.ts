import {addMinutes, addSeconds} from "date-fns";
import {
    TaskActivityFeedCreation,
    TaskActivityFeedWindow,
    deriveTaskActivityFeed as deriveWholeTaskActivityFeed,
} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    SpaceId,
    TaskActivityEntryId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    TaskActivityChange,
    TaskActivityFeedDiscreteEntryModel,
} from "~/shared/tasks/task_activity.js";

const spaceId = generateId<SpaceId>();
const taskId = generateId<TaskId>();
const rachel = {account: createAccountModel(), from: null} as const;
const ian = {account: createAccountModel(), from: null} as const;
const josh = createAccountModel();
const baseTime = new Date("2026-01-01T12:00:00.000Z");

type TaskActivityChangeWithoutTime = DistributiveOmit<TaskActivityChange, "actionTime">;

function discreteEntry({
    actor,
    time,
    change,
}: {
    actor: typeof rachel | null;
    time: Date;
    change: TaskActivityChangeWithoutTime;
}): TaskActivityFeedDiscreteEntryModel {
    return discreteEntries({actor, time, changes: [change]})[0]!;
}

function discreteEntries({
    actor,
    time,
    changes,
    actionTimes,
}: {
    actor: typeof rachel | null;
    time: Date;
    changes: ReadonlyArray<TaskActivityChangeWithoutTime>;
    actionTimes?: ReadonlyArray<HybridLogicalTime>;
}): Array<TaskActivityFeedDiscreteEntryModel> {
    const activityEntryId = generateChronologicalId<TaskActivityEntryId>();
    return [
        new TaskActivityFeedDiscreteEntryModel({
            activityEntryId,
            spaceId,
            taskId,
            actor,
            changes: changes.map((change, changeIndex) => ({
                ...change,
                actionTime: actionTimes?.[changeIndex] ?? [time.getTime(), changeIndex],
            })),
        }),
    ];
}

function deriveTaskActivityFeed({
    entries,
    windows,
    creation = createTaskActivityFeedCreation(addMinutes(baseTime, -60)),
    includeCreation = false,
}: {
    entries: ReadonlyArray<TaskActivityFeedDiscreteEntryModel>;
    windows: ReadonlyArray<TaskActivityFeedWindow>;
    creation?: TaskActivityFeedCreation | null;
    includeCreation?: boolean;
}) {
    const feedItems = deriveWholeTaskActivityFeed({entries, windows, creation});
    return includeCreation ? feedItems : feedItems.filter(item => item.type !== "TaskCreated");
}

function createTaskActivityFeedCreation(time: Date): TaskActivityFeedCreation {
    return {taskId, actor: rachel, actionTime: [time.getTime(), 0]};
}

function assigneeChange(
    from: AccountModel | null,
    to: AccountModel | null,
): TaskActivityChangeWithoutTime {
    return {type: "TaskAssigneeUpdated", previousAssignee: from, assignee: to};
}

function createAccountModel(id = generateId<AccountId>()): AccountModel {
    return new AccountModel({...AccountModel.getUnknownData(), id});
}

function membershipChange(
    collectionId: TaskCollectionId,
    fromIsMember: boolean,
    toIsMember: boolean,
): TaskActivityChangeWithoutTime {
    return {
        type: "TaskCollectionMembershipUpdated",
        collectionId,
        previousIsMember: fromIsMember,
        isMember: toIsMember,
    };
}

test("actor changes close windows, rendering interleavings faithfully", async () => {
    // The decision log's example: Rachel assigns Ian, Ian assigns Josh, Rachel
    // re-assigns Ian, all within the window.
    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            discreteEntry({
                actor: rachel,
                time: baseTime,
                change: assigneeChange(null, ian.account),
            }),
            discreteEntry({
                actor: ian,
                time: addSeconds(baseTime, 30),
                change: assigneeChange(ian.account, josh),
            }),
            discreteEntry({
                actor: rachel,
                time: addSeconds(baseTime, 60),
                change: assigneeChange(josh, ian.account),
            }),
        ],
    });

    expect(
        feedItems.map(item => ({
            actorId: item.type === "TaskAssigneeUpdated" ? item.actor?.account.id : undefined,
            assigneeId: item.type === "TaskAssigneeUpdated" ? item.assignee?.id : null,
        })),
    ).toMatchObject([
        {actorId: rachel.account.id, assigneeId: ian.account.id},
        {actorId: ian.account.id, assigneeId: josh.id},
        {actorId: rachel.account.id, assigneeId: ian.account.id},
    ]);
});

test("a multi-change entry flattens into one feed item per change in action order", async () => {
    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            ...discreteEntries({
                actor: rachel,
                time: baseTime,
                changes: [
                    {type: "TaskPriorityUpdated", previousPriority: null, priority: "High"},
                    {
                        type: "TaskStatusUpdated",
                        previousStatusType: "OpenInactive",
                        statusType: "OpenActive",
                    },
                ],
            }),
        ],
    });

    expect(feedItems).toMatchObject([
        {type: "TaskPriorityUpdated", priority: "High"},
        {type: "TaskStatusUpdated", statusType: "OpenActive"},
    ]);
});

test("a multi-change entry follows CRDT action time instead of transaction order", async () => {
    const alice = createAccountModel();
    const bob = createAccountModel();
    const laterActionTime = [baseTime.getTime(), 2] as const;
    const earlierActionTime = [baseTime.getTime(), 1] as const;

    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            ...discreteEntries({
                actor: rachel,
                time: baseTime,
                actionTimes: [laterActionTime, earlierActionTime],
                changes: [
                    {
                        type: "TaskAssigneeUpdated",
                        previousAssignee: null,
                        assignee: alice,
                    },
                    {
                        type: "TaskAssigneeUpdated",
                        assignee: bob,
                    },
                ],
            }),
        ],
    });

    expect(feedItems).toMatchObject([
        {
            type: "TaskAssigneeUpdated",
            previousAssignee: undefined,
            assignee: alice,
            actionTime: laterActionTime,
        },
    ]);
});

test("multi-change feed items sort by their numeric change index", async () => {
    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            ...discreteEntries({
                actor: rachel,
                time: baseTime,
                changes: [
                    {
                        type: "TaskDeletionUpdated",
                        previousIsDeleted: false,
                        isDeleted: true,
                    },
                    {type: "TaskPriorityUpdated", previousPriority: null, priority: "High"},
                    // Keeps the final status change at index 10 without introducing a stored creation
                    // event whose setup folding would obscure this ordering test.
                    ...Array.from({length: 8}, () => ({
                        type: "TaskLayoutUpdated" as const,
                        previousLayout: null,
                        layout: "Project" as const,
                    })),
                    {
                        type: "TaskStatusUpdated",
                        previousStatusType: "OpenInactive",
                        statusType: "OpenActive",
                    },
                ],
            }),
        ],
    });

    expect(feedItems.map(item => item.type)).toEqual([
        "TaskDeletionUpdated",
        "TaskPriorityUpdated",
        "TaskLayoutUpdated",
        "TaskStatusUpdated",
    ]);
});

test("a same-actor run within the window merges into one item", async () => {
    const other = createAccountModel();
    const firstEntry = discreteEntry({
        actor: rachel,
        time: baseTime,
        change: assigneeChange(null, other),
    });
    const secondEntry = discreteEntry({
        actor: rachel,
        time: addSeconds(baseTime, 30),
        change: assigneeChange(other, ian.account),
    });

    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [firstEntry, secondEntry],
    });

    expect(feedItems).toMatchObject([
        {
            type: "TaskAssigneeUpdated",
            actor: rachel,
            previousAssignee: null,
            assignee: ian.account,
            feedItemId: `${firstEntry.activityEntryId}:0`,
            sourceActivities: [
                {activityEntryId: firstEntry.activityEntryId},
                {activityEntryId: secondEntry.activityEntryId},
            ],
        },
    ]);
});

test("a fully reversed run renders as nothing", async () => {
    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            discreteEntry({
                actor: rachel,
                time: baseTime,
                change: assigneeChange(null, ian.account),
            }),
            discreteEntry({
                actor: rachel,
                time: addSeconds(baseTime, 30),
                change: assigneeChange(ian.account, null),
            }),
        ],
    });

    expect(feedItems).toEqual([]);
});

test("a gap past the window splits runs into separate items", async () => {
    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            discreteEntry({
                actor: rachel,
                time: baseTime,
                change: assigneeChange(null, ian.account),
            }),
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 5),
                change: assigneeChange(ian.account, null),
            }),
        ],
    });

    expect(feedItems).toHaveLength(2);
});

test("collection membership aggregates to a net delta across collections", async () => {
    const collectionA = generateId<TaskCollectionId>();
    const collectionB = generateId<TaskCollectionId>();

    // Add A, add B, then remove A: the A changes net out and only B remains.
    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            discreteEntry({
                actor: rachel,
                time: baseTime,
                change: membershipChange(collectionA, false, true),
            }),
            discreteEntry({
                actor: rachel,
                time: addSeconds(baseTime, 10),
                change: membershipChange(collectionB, false, true),
            }),
            discreteEntry({
                actor: rachel,
                time: addSeconds(baseTime, 20),
                change: membershipChange(collectionA, true, false),
            }),
        ],
    });

    expect(feedItems).toMatchObject([
        {
            type: "TaskCollectionMembershipUpdated",
            addedCollectionIds: [collectionB],
            removedCollectionIds: [],
        },
    ]);
});

test("reverted write-time windows are dropped and live ones pass through", async () => {
    const revertedWindow = {
        contentField: "Title" as const,
        activityEntryId: generateChronologicalId<TaskActivityEntryId>(),
        firstActivityTime: baseTime,
        lastActivityTime: addMinutes(baseTime, 1),
        wasReverted: true,
        fromVersion: 3,
        toVersion: 5,
        actors: [rachel],
        totalActorCount: 1,
    };
    const liveWindow = {
        contentField: "Notes" as const,
        activityEntryId: generateChronologicalId<TaskActivityEntryId>(),
        firstActivityTime: addMinutes(baseTime, 2),
        lastActivityTime: addMinutes(baseTime, 3),
        wasReverted: false,
        fromVersion: 0,
        toVersion: 9,
        actors: [rachel, ian],
        totalActorCount: 2,
    };

    const feedItems = deriveTaskActivityFeed({
        entries: [],
        windows: [revertedWindow, liveWindow],
    });

    expect(feedItems).toMatchObject([
        {type: "NotesWindow", fromVersion: 0, toVersion: 9, actors: [rachel, ian]},
    ]);
});

test("feed items sort and render at their latest represented activity time", async () => {
    const priorityTime = addMinutes(baseTime, 1);
    const notesWindow = notesWindowAt(priorityTime);
    const feedItems = deriveTaskActivityFeed({
        entries: [
            discreteEntry({
                actor: rachel,
                time: baseTime,
                change: {type: "TaskPriorityUpdated", previousPriority: null, priority: "High"},
            }),
            discreteEntry({
                actor: rachel,
                time: priorityTime,
                change: {
                    type: "TaskPriorityUpdated",
                    previousPriority: "High",
                    priority: "Medium",
                },
            }),
        ],
        windows: [notesWindow],
    });

    expect(feedItems.map(({type, feedItemTime}) => ({type, feedItemTime}))).toEqual([
        {type: "TaskPriorityUpdated", feedItemTime: priorityTime},
        {type: "NotesWindow", feedItemTime: notesWindow.lastActivityTime},
    ]);
    for (const feedItem of feedItems) {
        expect(feedItem).not.toHaveProperty("firstActivityTime");
        expect(feedItem).not.toHaveProperty("lastActivityTime");
        expect(feedItem).not.toHaveProperty("sortTime");
    }
});

test("an unknown before value still renders the item", async () => {
    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            discreteEntry({
                actor: rachel,
                time: baseTime,
                change: {type: "TaskAssigneeUpdated", assignee: ian.account},
            }),
        ],
    });

    expect(feedItems).toHaveLength(1);
});

function titleWindowAt(firstActivityTime: Date) {
    return {
        contentField: "Title" as const,
        activityEntryId: generateChronologicalId<TaskActivityEntryId>(),
        firstActivityTime,
        lastActivityTime: addMinutes(firstActivityTime, 1),
        wasReverted: false,
        fromVersion: 0,
        toVersion: 3,
        actors: [rachel],
        totalActorCount: 1,
    };
}

function notesWindowAt(firstActivityTime: Date) {
    return {...titleWindowAt(firstActivityTime), contentField: "Notes" as const};
}

test("creator setup folds into the stable created item while notes remain visible", async () => {
    const feedItems = deriveTaskActivityFeed({
        entries: [
            discreteEntry({actor: rachel, time: baseTime, change: {type: "TaskCreated"}}),
            // Rachel assigns her own new task to herself.
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 1),
                change: assigneeChange(null, rachel.account),
            }),
        ],
        windows: [titleWindowAt(baseTime), notesWindowAt(addMinutes(baseTime, 5))],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });

    expect(feedItems).toMatchObject([
        {
            type: "TaskCreated",
            feedItemId: `Task:${taskId}:Created`,
            feedItemTime: baseTime,
            sourceActivities: [
                {type: "DiscreteChange", change: {type: "TaskCreated"}},
                {type: "DiscreteChange", change: {type: "TaskAssigneeUpdated"}},
                {type: "ContentWindow", window: {contentField: "Title"}},
            ],
        },
        {type: "NotesWindow"},
    ]);
});

test("creator status and deletion actions remain visible during setup", async () => {
    const feedItems = deriveTaskActivityFeed({
        entries: [
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 1),
                change: {type: "TaskPriorityUpdated", previousPriority: null, priority: "High"},
            }),
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 2),
                change: {
                    type: "TaskStatusUpdated",
                    previousStatusType: "OpenInactive",
                    statusType: "OpenActive",
                },
            }),
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 3),
                change: {
                    type: "TaskDeletionUpdated",
                    previousIsDeleted: false,
                    isDeleted: true,
                },
            }),
        ],
        windows: [],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });

    expect(feedItems).toMatchObject([
        {
            type: "TaskCreated",
            sourceActivities: [{type: "DiscreteChange", change: {type: "TaskPriorityUpdated"}}],
        },
        {type: "TaskStatusUpdated"},
        {type: "TaskDeletionUpdated"},
    ]);
});

test("setup past the creation fold window renders normally", async () => {
    const feedItems = deriveTaskActivityFeed({
        entries: [
            discreteEntry({actor: rachel, time: baseTime, change: {type: "TaskCreated"}}),
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 16),
                change: assigneeChange(null, rachel.account),
            }),
        ],
        windows: [titleWindowAt(addMinutes(baseTime, 16)), notesWindowAt(addMinutes(baseTime, 20))],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });

    expect(feedItems).toHaveLength(4);
});

test("assignments at creation by other actors or to other accounts still render", async () => {
    const assignedByOther = deriveTaskActivityFeed({
        entries: [
            discreteEntry({actor: rachel, time: baseTime, change: {type: "TaskCreated"}}),
            // Ian self-assigns Rachel's fresh task: he took it, which is real news.
            discreteEntry({
                actor: ian,
                time: addMinutes(baseTime, 1),
                change: assigneeChange(null, ian.account),
            }),
        ],
        windows: [],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });
    const assignedToOther = deriveTaskActivityFeed({
        entries: [
            discreteEntry({actor: rachel, time: baseTime, change: {type: "TaskCreated"}}),
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 1),
                change: assigneeChange(null, ian.account),
            }),
        ],
        windows: [],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });

    expect({
        assignedByOther: assignedByOther.length,
        assignedToOther: assignedToOther.length,
    }).toEqual({assignedByOther: 2, assignedToOther: 2});
});

test("a creator assignment cleared later in the fold window folds too", async () => {
    // The clear lands past the two-minute merge window, so it becomes its own run
    // instead of reverting the first one — it must still fold.
    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            discreteEntry({actor: rachel, time: baseTime, change: {type: "TaskCreated"}}),
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 1),
                change: assigneeChange(null, rachel.account),
            }),
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 5),
                change: assigneeChange(rachel.account, null),
            }),
        ],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });

    expect(feedItems).toMatchObject([{type: "TaskCreated"}]);
});

test("clearing a real assignment within the fold window still renders", async () => {
    // Ian was genuinely assigned and then removed: both are real news even minutes
    // after creation, because neither nets back to the creation default.
    const feedItems = deriveTaskActivityFeed({
        windows: [],
        entries: [
            discreteEntry({actor: rachel, time: baseTime, change: {type: "TaskCreated"}}),
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 1),
                change: assigneeChange(null, ian.account),
            }),
            discreteEntry({
                actor: ian,
                time: addMinutes(baseTime, 5),
                change: assigneeChange(ian.account, null),
            }),
        ],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });

    expect(feedItems).toHaveLength(3);
});

test("a non-creator action remains visible without ending creator setup folding", async () => {
    const feedItems = deriveTaskActivityFeed({
        entries: [
            discreteEntry({actor: rachel, time: baseTime, change: {type: "TaskCreated"}}),
            discreteEntry({
                actor: ian,
                time: addMinutes(baseTime, 2),
                change: {type: "TaskPriorityUpdated", previousPriority: null, priority: "High"},
            }),
        ],
        windows: [titleWindowAt(addMinutes(baseTime, 3))],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });

    expect(feedItems).toMatchObject([
        {type: "TaskCreated"},
        {type: "TaskPriorityUpdated", actor: ian},
    ]);
});

test("task-model creation folds setup without a stored creation change", async () => {
    const feedItems = deriveTaskActivityFeed({
        entries: [
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 5),
                change: assigneeChange(null, rachel.account),
            }),
        ],
        windows: [titleWindowAt(addMinutes(baseTime, 3))],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });

    expect(feedItems).toMatchObject([
        {
            type: "TaskCreated",
            sourceActivities: [
                {type: "ContentWindow"},
                {type: "DiscreteChange", change: {type: "TaskAssigneeUpdated"}},
            ],
        },
    ]);
});

test("a stored creation event takes precedence over task-model creation", async () => {
    const feedItems = deriveTaskActivityFeed({
        entries: [discreteEntry({actor: rachel, time: baseTime, change: {type: "TaskCreated"}})],
        windows: [],
        creation: {taskId, actor: ian, actionTime: [baseTime.getTime(), 0]},
        includeCreation: true,
    });

    expect(feedItems).toMatchObject([{type: "TaskCreated", actor: rachel}]);
});

test("creation moves one minute before earlier activity", async () => {
    const activityTime = addMinutes(baseTime, -10);
    const expectedCreationTime = addMinutes(activityTime, -1);
    const feedItems = deriveTaskActivityFeed({
        entries: [
            discreteEntry({
                actor: ian,
                time: activityTime,
                change: {type: "TaskPriorityUpdated", previousPriority: null, priority: "High"},
            }),
        ],
        windows: [],
        creation: createTaskActivityFeedCreation(baseTime),
        includeCreation: true,
    });

    expect(feedItems).toMatchObject([
        {
            type: "TaskCreated",
            feedItemTime: expectedCreationTime,
            actionTime: [expectedCreationTime.getTime(), 0],
        },
        {type: "TaskPriorityUpdated", feedItemTime: activityTime},
    ]);
});

test("a stored creation event is used when task-model creation is unavailable", async () => {
    const feedItems = deriveTaskActivityFeed({
        entries: [discreteEntry({actor: rachel, time: baseTime, change: {type: "TaskCreated"}})],
        windows: [],
        creation: null,
        includeCreation: true,
    });

    expect(feedItems).toMatchObject([
        {
            type: "TaskCreated",
            feedItemId: `Task:${taskId}:Created`,
            feedItemTime: baseTime,
            actor: rachel,
        },
    ]);
});

test("creation is omitted when task metadata and activity events are unavailable", async () => {
    const feedItems = deriveTaskActivityFeed({
        entries: [
            discreteEntry({
                actor: rachel,
                time: addMinutes(baseTime, 10),
                change: {type: "TaskPriorityUpdated", previousPriority: null, priority: "High"},
            }),
        ],
        windows: [],
        creation: null,
        includeCreation: true,
    });

    expect(feedItems).toMatchObject([{type: "TaskPriorityUpdated"}]);
});
