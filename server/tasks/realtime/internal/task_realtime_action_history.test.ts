import {TaskRealtimeActionHistory} from "~/server/tasks/realtime/internal/task_realtime_action_history.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

import.meta.jest.useFakeTimers();

const clock1 = new MonotonicClock(unsynchronizedSystemClock);
const clock2 = new HybridLogicalClock(clock1);

function getActionTransactions(history: TaskRealtimeActionHistory, spaceId: SpaceId) {
    const actionTransactions: Array<ReadonlyArray<TaskAction>> = [];
    history.iterateActionTransactions(spaceId, actions => {
        actionTransactions.push(actions);
    });
    return actionTransactions;
}

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

test("ignores actions before start is called", () => {
    const spaceId = generateId<SpaceId>();

    const history = new TaskRealtimeActionHistory();

    history.assertCorrectForTest();

    history.addActionTransaction({
        spaceId,
        committedTime: new Date(clock1.now()),
        actions: [
            {
                type: "UpdateTask",
                time: clock2.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: generateId(),
                        workingAccountName: "Test",
                    }),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    });

    history.assertCorrectForTest();
});

test("creates an empty segment after start is called", () => {
    const history = new TaskRealtimeActionHistory();

    history.assertCorrectForTest();
    history.start();
    history.assertCorrectForTest();
    history.stop();
    history.assertCorrectForTest();
});

test("records actions after start is called", () => {
    const spaceId1 = generateId<SpaceId>();
    const spaceId2 = generateId<SpaceId>();

    const history = new TaskRealtimeActionHistory();

    history.start();

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId1).length).toEqual(0);
    expect(getActionTransactions(history, spaceId2).length).toEqual(0);

    history.addActionTransaction({
        spaceId: spaceId1,
        committedTime: new Date(clock1.now()),
        actions: [
            {
                type: "UpdateTask",
                time: clock2.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: generateId(),
                        workingAccountName: "Test",
                    }),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    });

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId1).length).toEqual(1);
    expect(getActionTransactions(history, spaceId2).length).toEqual(0);

    history.addActionTransaction({
        spaceId: spaceId1,
        committedTime: new Date(clock1.now()),
        actions: [
            {
                type: "UpdateTask",
                time: clock2.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: generateId(),
                        workingAccountName: "Test",
                    }),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    });

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId1).length).toEqual(2);
    expect(getActionTransactions(history, spaceId2).length).toEqual(0);

    history.addActionTransaction({
        spaceId: spaceId2,
        committedTime: new Date(clock1.now()),
        actions: [
            {
                type: "UpdateTask",
                time: clock2.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: generateId(),
                        workingAccountName: "Test",
                    }),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    });

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId1).length).toEqual(2);
    expect(getActionTransactions(history, spaceId2).length).toEqual(1);

    history.addActionTransaction({
        spaceId: spaceId2,
        committedTime: new Date(clock1.now() - 1000 * 60 * 2),
        actions: [
            {
                type: "UpdateTask",
                time: clock2.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: generateId(),
                        workingAccountName: "Test",
                    }),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    });

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId1).length).toEqual(2);
    expect(getActionTransactions(history, spaceId2).length).toEqual(2);

    history.stop();

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId1).length).toEqual(0);
    expect(getActionTransactions(history, spaceId2).length).toEqual(0);
});

test("will expire some actions whenever the timer runs", () => {
    const spaceId = generateId<SpaceId>();

    let mockTime = Date.now();
    const originalDateNow = Date.now;
    Date.now = () => mockTime;
    try {
        const history = new TaskRealtimeActionHistory();

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(0);

        history.start();

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(0);

        history.addActionTransaction({
            spaceId,
            committedTime: new Date(mockTime - 1000 * 60 * 5.2),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: new TaskSortableAccount({
                            accountId: generateId(),
                            workingAccountName: "Test",
                        }),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        });

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(0);

        history.addActionTransaction({
            spaceId,
            committedTime: new Date(mockTime - 1000 * 60 * 4.8),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: new TaskSortableAccount({
                            accountId: generateId(),
                            workingAccountName: "Test",
                        }),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        });

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(1);

        history.addActionTransaction({
            spaceId,
            committedTime: new Date(mockTime - 1000 * 60 * 2.8),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: new TaskSortableAccount({
                            accountId: generateId(),
                            workingAccountName: "Test",
                        }),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        });

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(2);

        history.addActionTransaction({
            spaceId,
            committedTime: new Date(mockTime - 1000 * 60 * 2.6),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: new TaskSortableAccount({
                            accountId: generateId(),
                            workingAccountName: "Test",
                        }),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        });

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(3);

        history.addActionTransaction({
            spaceId,
            committedTime: new Date(mockTime),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: new TaskSortableAccount({
                            accountId: generateId(),
                            workingAccountName: "Test",
                        }),
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        });

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(4);

        mockTime += 1000 * 60;
        import.meta.jest.advanceTimersByTime(1000 * 60);

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(3);

        mockTime += 1000 * 60;
        import.meta.jest.advanceTimersByTime(1000 * 60);

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(3);

        mockTime += 1000 * 10;
        import.meta.jest.advanceTimersByTime(1000 * 10);

        mockTime += 1000 * 5;
        import.meta.jest.advanceTimersByTime(1000 * 5);

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(3);

        // Intentionally desync time...
        mockTime += 1000 * 5 + 100;
        import.meta.jest.advanceTimersByTime(1000 * 5);

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(2);

        mockTime += 1000 * 20 - 100;
        import.meta.jest.advanceTimersByTime(1000 * 20 - 100);

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(1);

        // Resync time...
        mockTime += 1000 * 5 - 100;
        import.meta.jest.advanceTimersByTime(1000 * 5);

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(1);

        history.stop();

        history.assertCorrectForTest();
        expect(getActionTransactions(history, spaceId).length).toEqual(0);
    } finally {
        Date.now = originalDateNow;
    }
});

test("will clear entire history", () => {
    const spaceId = generateId<SpaceId>();

    const history = new TaskRealtimeActionHistory();

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId).length).toEqual(0);

    history.start();

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId).length).toEqual(0);

    history.addActionTransaction({
        spaceId,
        committedTime: new Date(Date.now()),
        actions: [
            {
                type: "UpdateTask",
                time: clock2.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: generateId(),
                        workingAccountName: "Test",
                    }),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    });

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId).length).toEqual(1);

    history.addActionTransaction({
        spaceId,
        committedTime: new Date(Date.now()),
        actions: [
            {
                type: "UpdateTask",
                time: clock2.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: generateId(),
                        workingAccountName: "Test",
                    }),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    });

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId).length).toEqual(2);

    history.addActionTransaction({
        spaceId,
        committedTime: new Date(Date.now()),
        actions: [
            {
                type: "UpdateTask",
                time: clock2.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: generateId(),
                        workingAccountName: "Test",
                    }),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    });

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId).length).toEqual(3);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId).length).toEqual(0);

    history.addActionTransaction({
        spaceId,
        committedTime: new Date(Date.now() - 1000 * 20),
        actions: [
            {
                type: "UpdateTask",
                time: clock2.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: new TaskSortableAccount({
                        accountId: generateId(),
                        workingAccountName: "Test",
                    }),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    });

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId).length).toEqual(1);

    history.stop();

    history.assertCorrectForTest();
    expect(getActionTransactions(history, spaceId).length).toEqual(0);
});
