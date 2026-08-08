import {TaskRealtimeActionHistory} from "~/server/tasks/realtime/task_realtime_action_history.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.open_source.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

import.meta.jest.useFakeTimers();

const clock1 = new MonotonicClock(unsynchronizedSystemClock);
const clock2 = new HybridLogicalClock(clock1);

function getActions(history: TaskRealtimeActionHistory, spaceId: SpaceId) {
    const actions: Array<TaskAction> = [];
    history.iterateActions(testTracer, spaceId, action => {
        actions.push(action);
    });
    return actions;
}

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

test("ignores actions before start is called", () => {
    const spaceId = generateId<SpaceId>();

    const [history] = TaskRealtimeActionHistory.new();

    history.assertCorrectForTest();

    history.addActionTransaction(
        {
            spaceId,
            committedTime: new Date(clock1.now()),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: generateId(), from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        },
        [],
    );

    history.assertCorrectForTest();
});

test("creates an empty segment after start is called", () => {
    const [history, {start, stop}] = TaskRealtimeActionHistory.new();

    history.assertCorrectForTest();
    start();
    history.assertCorrectForTest();
    stop();
    history.assertCorrectForTest();
});

test("records actions after start is called", () => {
    const spaceId1 = generateId<SpaceId>();
    const spaceId2 = generateId<SpaceId>();

    const [history, {start, stop}] = TaskRealtimeActionHistory.new();

    start();

    history.assertCorrectForTest();
    expect(getActions(history, spaceId1).length).toEqual(0);
    expect(getActions(history, spaceId2).length).toEqual(0);

    history.addActionTransaction(
        {
            spaceId: spaceId1,
            committedTime: new Date(clock1.now()),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: generateId(), from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        },
        [],
    );

    history.assertCorrectForTest();
    expect(getActions(history, spaceId1).length).toEqual(1);
    expect(getActions(history, spaceId2).length).toEqual(0);

    history.addActionTransaction(
        {
            spaceId: spaceId1,
            committedTime: new Date(clock1.now()),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: generateId(), from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        },
        [],
    );

    history.assertCorrectForTest();
    expect(getActions(history, spaceId1).length).toEqual(2);
    expect(getActions(history, spaceId2).length).toEqual(0);

    history.addActionTransaction(
        {
            spaceId: spaceId2,
            committedTime: new Date(clock1.now()),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: generateId(), from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        },
        [],
    );

    history.assertCorrectForTest();
    expect(getActions(history, spaceId1).length).toEqual(2);
    expect(getActions(history, spaceId2).length).toEqual(1);

    history.addActionTransaction(
        {
            spaceId: spaceId2,
            committedTime: new Date(clock1.now() - 1000 * 60 * 2),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: generateId(), from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        },
        [],
    );

    history.assertCorrectForTest();
    expect(getActions(history, spaceId1).length).toEqual(2);
    expect(getActions(history, spaceId2).length).toEqual(2);

    stop();

    history.assertCorrectForTest();
    expect(getActions(history, spaceId1).length).toEqual(0);
    expect(getActions(history, spaceId2).length).toEqual(0);
});

test("will expire some actions whenever the timer runs", () => {
    const spaceId = generateId<SpaceId>();

    let mockTime = Date.now();
    const originalDateNow = Date.now;
    Date.now = () => mockTime;
    try {
        const [history, {start, stop}] = TaskRealtimeActionHistory.new();

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(0);

        start();

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(0);

        history.addActionTransaction(
            {
                spaceId,
                committedTime: new Date(Math.floor(mockTime - 1000 * 60 * 10.4)),
                actions: [
                    {
                        type: "UpdateTask",
                        time: clock2.now(),
                        taskId: generateId(),
                        taskAction: {
                            type: "Create",
                            creator: {accountId: generateId(), from: null},
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                ],
            },
            [],
        );

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(0);

        history.addActionTransaction(
            {
                spaceId,
                committedTime: new Date(Math.floor(mockTime - 1000 * 60 * 9.6)),
                actions: [
                    {
                        type: "UpdateTask",
                        time: clock2.now(),
                        taskId: generateId(),
                        taskAction: {
                            type: "Create",
                            creator: {accountId: generateId(), from: null},
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                ],
            },
            [],
        );

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(1);

        history.addActionTransaction(
            {
                spaceId,
                committedTime: new Date(Math.floor(mockTime - 1000 * 60 * 5.6)),
                actions: [
                    {
                        type: "UpdateTask",
                        time: clock2.now(),
                        taskId: generateId(),
                        taskAction: {
                            type: "Create",
                            creator: {accountId: generateId(), from: null},
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                ],
            },
            [],
        );

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(2);

        history.addActionTransaction(
            {
                spaceId,
                committedTime: new Date(Math.floor(mockTime - 1000 * 60 * 3.2)),
                actions: [
                    {
                        type: "UpdateTask",
                        time: clock2.now(),
                        taskId: generateId(),
                        taskAction: {
                            type: "Create",
                            creator: {accountId: generateId(), from: null},
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                ],
            },
            [],
        );

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(3);

        history.addActionTransaction(
            {
                spaceId,
                committedTime: new Date(mockTime),
                actions: [
                    {
                        type: "UpdateTask",
                        time: clock2.now(),
                        taskId: generateId(),
                        taskAction: {
                            type: "Create",
                            creator: {accountId: generateId(), from: null},
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                ],
            },
            [],
        );

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(4);

        mockTime += 1000 * 60 * 2;
        import.meta.jest.advanceTimersByTime(1000 * 60 * 2);

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(3);

        mockTime += 1000 * 60 * 2;
        import.meta.jest.advanceTimersByTime(1000 * 60 * 2);

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(3);

        mockTime += 1000 * 20;
        import.meta.jest.advanceTimersByTime(1000 * 20);

        mockTime += 1000 * 10;
        import.meta.jest.advanceTimersByTime(1000 * 10);

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(3);

        // Intentionally desync time...
        mockTime += 1000 * 10 + 100;
        import.meta.jest.advanceTimersByTime(1000 * 10);

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(2);

        mockTime += 1000 * 180 - 100;
        import.meta.jest.advanceTimersByTime(1000 * 180 - 100);

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(1);

        // Resync time...
        mockTime += 1000 * 10 - 100;
        import.meta.jest.advanceTimersByTime(1000 * 10);

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(1);

        stop();

        history.assertCorrectForTest();
        expect(getActions(history, spaceId).length).toEqual(0);
    } finally {
        Date.now = originalDateNow;
    }
});

test("will clear entire history", () => {
    const spaceId = generateId<SpaceId>();

    const [history, {start, stop}] = TaskRealtimeActionHistory.new();

    history.assertCorrectForTest();
    expect(getActions(history, spaceId).length).toEqual(0);

    start();

    history.assertCorrectForTest();
    expect(getActions(history, spaceId).length).toEqual(0);

    history.addActionTransaction(
        {
            spaceId,
            committedTime: new Date(Date.now()),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: generateId(), from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        },
        [],
    );

    history.assertCorrectForTest();
    expect(getActions(history, spaceId).length).toEqual(1);

    history.addActionTransaction(
        {
            spaceId,
            committedTime: new Date(Date.now()),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: generateId(), from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        },
        [],
    );

    history.assertCorrectForTest();
    expect(getActions(history, spaceId).length).toEqual(2);

    history.addActionTransaction(
        {
            spaceId,
            committedTime: new Date(Date.now()),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: generateId(), from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        },
        [],
    );

    history.assertCorrectForTest();
    expect(getActions(history, spaceId).length).toEqual(3);

    import.meta.jest.advanceTimersByTime(1000 * 60 * 60);

    history.assertCorrectForTest();
    expect(getActions(history, spaceId).length).toEqual(0);

    history.addActionTransaction(
        {
            spaceId,
            committedTime: new Date(Date.now() - 1000 * 20),
            actions: [
                {
                    type: "UpdateTask",
                    time: clock2.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: generateId(), from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ],
        },
        [],
    );

    history.assertCorrectForTest();
    expect(getActions(history, spaceId).length).toEqual(1);

    stop();

    history.assertCorrectForTest();
    expect(getActions(history, spaceId).length).toEqual(0);
});
