import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskGridViewExpansionState,
    areChildTasksExpandedInGridView,
    collapseChildTaskInGridView,
    diffTaskGridViewExpansionStates,
    expandChildTaskInGridView,
    moveTaskGridViewExpansionTaskState,
} from "~/shared/tasks/task_grid_view_expansion_state.js";

test("can determine child tasks are not expanded on null state", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = null;

    expect(areChildTasksExpandedInGridView(state, [task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task3Id])).toEqual(false);
});

test("can determine child tasks are expanded on state first level", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = new Map([
        [task1Id, {isExpanded: false, childTasks: null}],
        [task3Id, {isExpanded: true, childTasks: null}],
    ]);

    expect(areChildTasksExpandedInGridView(state, [task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task3Id])).toEqual(true);
});

test("can determine nested child tasks are expanded", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = new Map([
        [
            task1Id,
            {
                isExpanded: true,
                childTasks: new Map([
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [task3Id, {isExpanded: true, childTasks: null}],
                                [task4Id, {isExpanded: true, childTasks: null}],
                            ]),
                        },
                    ],
                ]),
            },
        ],
        [task4Id, {isExpanded: true, childTasks: null}],
    ]);

    expect(areChildTasksExpandedInGridView(state, [task1Id])).toEqual(true);
    expect(areChildTasksExpandedInGridView(state, [task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task3Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id])).toEqual(true);
    expect(areChildTasksExpandedInGridView(state, [task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id])).toEqual(true);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task4Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task3Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task4Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task3Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task4Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task3Id])).toEqual(true);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task4Id])).toEqual(true);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task3Id, task4Id])).toEqual(
        false,
    );
});

test("can determine nested child tasks are not if an intermediate task is collapsed", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = new Map([
        [
            task1Id,
            {
                isExpanded: true,
                childTasks: new Map([
                    [
                        task2Id,
                        {
                            isExpanded: false,
                            childTasks: new Map([
                                [task3Id, {isExpanded: true, childTasks: null}],
                                [task4Id, {isExpanded: true, childTasks: null}],
                            ]),
                        },
                    ],
                ]),
            },
        ],
        [task2Id, {isExpanded: true, childTasks: null}],
        [task4Id, {isExpanded: true, childTasks: null}],
    ]);

    expect(areChildTasksExpandedInGridView(state, [task1Id])).toEqual(true);
    expect(areChildTasksExpandedInGridView(state, [task2Id])).toEqual(true);
    expect(areChildTasksExpandedInGridView(state, [task3Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id])).toEqual(true);
    expect(areChildTasksExpandedInGridView(state, [task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task4Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task3Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task4Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task4Id, task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task3Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task4Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task3Id, task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task1Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task2Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task3Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task4Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task5Id])).toEqual(false);
    expect(areChildTasksExpandedInGridView(state, [task1Id, task2Id, task3Id, task4Id])).toEqual(
        false,
    );
});

test("can expand a child task on null state", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = null;

    expect(expandChildTaskInGridView(state, [task1Id])).toEqual(
        new Map([[task1Id, {isExpanded: true, childTasks: null}]]),
    );
    expect(expandChildTaskInGridView(state, [task2Id])).toEqual(
        new Map([[task2Id, {isExpanded: true, childTasks: null}]]),
    );
    expect(expandChildTaskInGridView(state, [task1Id, task2Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: true,
                    childTasks: new Map([[task2Id, {isExpanded: true, childTasks: null}]]),
                },
            ],
        ]),
    );
    expect(expandChildTaskInGridView(state, [task1Id, task2Id, task3Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task2Id,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [task3Id, {isExpanded: true, childTasks: null}],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
        ]),
    );
});

test("can expand a child task on existing single expansion state", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = new Map([
        [task1Id, {isExpanded: true, childTasks: null}],
    ]);

    expect(expandChildTaskInGridView(state, [task1Id])).toBe(state);
    expect(expandChildTaskInGridView(state, [task2Id])).toEqual(
        new Map([
            [task1Id, {isExpanded: true, childTasks: null}],
            [task2Id, {isExpanded: true, childTasks: null}],
        ]),
    );
    expect(expandChildTaskInGridView(state, [task1Id, task2Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: true,
                    childTasks: new Map([[task2Id, {isExpanded: true, childTasks: null}]]),
                },
            ],
        ]),
    );
    expect(expandChildTaskInGridView(state, [task1Id, task2Id, task3Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task2Id,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [task3Id, {isExpanded: true, childTasks: null}],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
        ]),
    );
});

test("can expand a child task on existing nested expansion state", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = new Map([
        [
            task1Id,
            {
                isExpanded: true,
                childTasks: new Map([[task2Id, {isExpanded: true, childTasks: null}]]),
            },
        ],
    ]);

    expect(expandChildTaskInGridView(state, [task1Id])).toBe(state);
    expect(expandChildTaskInGridView(state, [task2Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: true,
                    childTasks: new Map([[task2Id, {isExpanded: true, childTasks: null}]]),
                },
            ],
            [task2Id, {isExpanded: true, childTasks: null}],
        ]),
    );
    expect(expandChildTaskInGridView(state, [task1Id, task2Id])).toBe(state);
    expect(expandChildTaskInGridView(state, [task1Id, task2Id, task3Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task2Id,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [task3Id, {isExpanded: true, childTasks: null}],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
        ]),
    );
});

test("can expand a collapsed child task", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = new Map([
        [
            task1Id,
            {
                isExpanded: true,
                childTasks: new Map([
                    [
                        task2Id,
                        {
                            isExpanded: false,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                ]),
            },
        ],
    ]);

    expect(expandChildTaskInGridView(state, [task1Id])).toBe(state);
    expect(expandChildTaskInGridView(state, [task1Id, task2Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task2Id,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [task3Id, {isExpanded: true, childTasks: null}],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
        ]),
    );
    expect(expandChildTaskInGridView(state, [task1Id, task2Id, task3Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task2Id,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [task3Id, {isExpanded: true, childTasks: null}],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
        ]),
    );
    expect(expandChildTaskInGridView(state, [task1Id, task2Id, task4Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task2Id,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [task3Id, {isExpanded: true, childTasks: null}],
                                    [task4Id, {isExpanded: true, childTasks: null}],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
        ]),
    );
});

test("can collapse a child task on null state", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = null;

    expect(collapseChildTaskInGridView(state, [task1Id])).toEqual(null);
    expect(collapseChildTaskInGridView(state, [task2Id])).toEqual(null);
    expect(collapseChildTaskInGridView(state, [task1Id, task2Id])).toEqual(null);
    expect(collapseChildTaskInGridView(state, [task1Id, task2Id, task3Id])).toEqual(null);
});

test("can collapse a child task", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = new Map([
        [task1Id, {isExpanded: true, childTasks: null}],
    ]);

    expect(collapseChildTaskInGridView(state, [task1Id])).toEqual(null);
    expect(collapseChildTaskInGridView(state, [task2Id])).toBe(state);
    expect(collapseChildTaskInGridView(state, [task1Id, task3Id])).toBe(state);
});

test("can collapse a child task when there are multiple child tasks", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = new Map([
        [task1Id, {isExpanded: true, childTasks: null}],
        [task2Id, {isExpanded: true, childTasks: null}],
    ]);

    expect(collapseChildTaskInGridView(state, [task1Id])).toEqual(
        new Map([[task2Id, {isExpanded: true, childTasks: null}]]),
    );
    expect(collapseChildTaskInGridView(state, [task2Id])).toEqual(
        new Map([[task1Id, {isExpanded: true, childTasks: null}]]),
    );
    expect(collapseChildTaskInGridView(state, [task1Id, task3Id])).toBe(state);
});

test("can collapse a nested child task", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();

    const state: TaskGridViewExpansionState = new Map([
        [
            task1Id,
            {
                isExpanded: true,
                childTasks: new Map([[task2Id, {isExpanded: true, childTasks: null}]]),
            },
        ],
    ]);

    expect(collapseChildTaskInGridView(state, [task1Id])).toEqual(
        new Map([
            [
                task1Id,
                {
                    isExpanded: false,
                    childTasks: new Map([[task2Id, {isExpanded: true, childTasks: null}]]),
                },
            ],
        ]),
    );
    expect(collapseChildTaskInGridView(state, [task2Id])).toBe(state);
    expect(collapseChildTaskInGridView(state, [task1Id, task2Id])).toEqual(
        new Map([[task1Id, {isExpanded: true, childTasks: null}]]),
    );
});

test("can diff null states", () => {
    expect(Array.from(diffTaskGridViewExpansionStates(null, null))).toEqual([]);
});

test("can diff identical states", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();

    expect(
        Array.from(
            diffTaskGridViewExpansionStates(
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: false,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: false,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
            ),
        ),
    ).toEqual([]);
});

test("can diff a null state with a new state", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();

    expect(
        Array.from(
            diffTaskGridViewExpansionStates(
                null,
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: false,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
            ),
        ),
    ).toEqual([
        {
            taskPath: [task1Id],
            isExpanded: true,
        },
        {
            taskPath: [task2Id],
            isExpanded: true,
        },
        {
            taskPath: [task2Id, task3Id],
            isExpanded: true,
        },
        {
            taskPath: [task4Id],
            isExpanded: true,
        },
    ]);
});

test("can diff a null state with an old new state", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();

    expect(
        Array.from(
            diffTaskGridViewExpansionStates(
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: false,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
                null,
            ),
        ),
    ).toEqual([
        {
            taskPath: [task1Id],
            isExpanded: false,
        },
        {
            taskPath: [task2Id],
            isExpanded: false,
        },
        {
            taskPath: [task2Id, task3Id],
            isExpanded: false,
        },
        {
            taskPath: [task4Id],
            isExpanded: false,
        },
    ]);
});

test("can diff states with a single change", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();

    expect(
        Array.from(
            diffTaskGridViewExpansionStates(
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: false,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: false, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: false,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
            ),
        ),
    ).toEqual([
        {
            taskPath: [task2Id, task3Id],
            isExpanded: false,
        },
    ]);
});

test("diffing state with an old collapsed parent reveals its expanded children", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();

    expect(
        Array.from(
            diffTaskGridViewExpansionStates(
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: false,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: true,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
            ),
        ),
    ).toEqual([
        {
            taskPath: [task4Id, task5Id],
            isExpanded: true,
        },
        {
            taskPath: [task4Id, task5Id, task6Id],
            isExpanded: true,
        },
    ]);
});

test("diffing state with a new collapsed parent reveals its expanded children", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();
    const task6Id = generateId<TaskId>();

    expect(
        Array.from(
            diffTaskGridViewExpansionStates(
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: true,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
                new Map([
                    [task1Id, {isExpanded: true, childTasks: null}],
                    [
                        task2Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([[task3Id, {isExpanded: true, childTasks: null}]]),
                        },
                    ],
                    [
                        task4Id,
                        {
                            isExpanded: true,
                            childTasks: new Map([
                                [
                                    task5Id,
                                    {
                                        isExpanded: false,
                                        childTasks: new Map([
                                            [task6Id, {isExpanded: true, childTasks: null}],
                                        ]),
                                    },
                                ],
                            ]),
                        },
                    ],
                ]),
            ),
        ),
    ).toEqual([
        {
            taskPath: [task4Id, task5Id],
            isExpanded: false,
        },
        {
            taskPath: [task4Id, task5Id, task6Id],
            isExpanded: false,
        },
    ]);
});

test("can move task expansion state down a level", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();

    expect(
        moveTaskGridViewExpansionTaskState(
            new Map([
                [
                    task2Id,
                    {
                        isExpanded: true,
                        childTasks: new Map([[task1Id, {isExpanded: true, childTasks: null}]]),
                    },
                ],
            ]),
            [task2Id],
            [],
            task1Id,
        ),
    ).toEqual(
        new Map([
            [task2Id, {isExpanded: true, childTasks: null}],
            [task1Id, {isExpanded: true, childTasks: null}],
        ]),
    );
});

test("can move task expansion state up a level", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();

    expect(
        moveTaskGridViewExpansionTaskState(
            new Map([
                [task2Id, {isExpanded: true, childTasks: null}],
                [task1Id, {isExpanded: true, childTasks: null}],
            ]),
            [],
            [task2Id],
            task1Id,
        ),
    ).toEqual(
        new Map([
            [
                task2Id,
                {
                    isExpanded: true,
                    childTasks: new Map([[task1Id, {isExpanded: true, childTasks: null}]]),
                },
            ],
        ]),
    );
});

test("can\u2019t expand task when it can\u2019t be received", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();

    expect(
        moveTaskGridViewExpansionTaskState(
            new Map([[task1Id, {isExpanded: true, childTasks: null}]]),
            [],
            [task2Id],
            task1Id,
        ),
    ).toEqual(null);
});

test("can move task expansion state into more deep parent", () => {
    const task1aId = generateId<TaskId>();
    const task1bId = generateId<TaskId>();
    const task2aId = generateId<TaskId>();
    const task2bId = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    expect(
        moveTaskGridViewExpansionTaskState(
            new Map([
                [
                    task2aId,
                    {
                        isExpanded: true,
                        childTasks: new Map([
                            [
                                task3Id,
                                {
                                    isExpanded: true,
                                    childTasks: new Map([
                                        [task4Id, {isExpanded: true, childTasks: null}],
                                    ]),
                                },
                            ],
                        ]),
                    },
                ],
                [
                    task1bId,
                    {
                        isExpanded: true,
                        childTasks: new Map([[task2bId, {isExpanded: true, childTasks: null}]]),
                    },
                ],
            ]),
            [task1aId, task2aId],
            [task1bId, task2bId],
            task3Id,
        ),
    ).toEqual(
        new Map([
            [task2aId, {isExpanded: true, childTasks: null}],
            [
                task1bId,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task2bId,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [
                                        task3Id,
                                        {
                                            isExpanded: true,
                                            childTasks: new Map([
                                                [task4Id, {isExpanded: true, childTasks: null}],
                                            ]),
                                        },
                                    ],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
        ]),
    );
});

test("can move task expansion state to less deep parent", () => {
    const task1aId = generateId<TaskId>();
    const task1bId = generateId<TaskId>();
    const task2aId = generateId<TaskId>();
    const task2bId = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();

    expect(
        moveTaskGridViewExpansionTaskState(
            new Map([
                [
                    task1aId,
                    {
                        isExpanded: true,
                        childTasks: new Map([
                            [
                                task2aId,
                                {
                                    isExpanded: true,
                                    childTasks: new Map([
                                        [
                                            task3Id,
                                            {
                                                isExpanded: true,
                                                childTasks: new Map([
                                                    [task4Id, {isExpanded: true, childTasks: null}],
                                                ]),
                                            },
                                        ],
                                    ]),
                                },
                            ],
                        ]),
                    },
                ],
                [task2bId, {isExpanded: true, childTasks: null}],
            ]),
            [task1aId, task2aId],
            [task1bId, task2bId],
            task3Id,
        ),
    ).toEqual(
        new Map([
            [
                task1aId,
                {
                    isExpanded: true,
                    childTasks: new Map([[task2aId, {isExpanded: true, childTasks: null}]]),
                },
            ],
            [
                task2bId,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task3Id,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [task4Id, {isExpanded: true, childTasks: null}],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
        ]),
    );
});

test("can move task expansion state when present multiple times", () => {
    const task1aId = generateId<TaskId>();
    const task1bId = generateId<TaskId>();
    const task2aId = generateId<TaskId>();
    const task2bId = generateId<TaskId>();
    const task3Id = generateId<TaskId>();
    const task4Id = generateId<TaskId>();
    const task5Id = generateId<TaskId>();

    expect(
        moveTaskGridViewExpansionTaskState(
            new Map([
                [
                    task1aId,
                    {
                        isExpanded: true,
                        childTasks: new Map([
                            [
                                task2aId,
                                {
                                    isExpanded: true,
                                    childTasks: new Map([
                                        [
                                            task3Id,
                                            {
                                                isExpanded: true,
                                                childTasks: new Map([
                                                    [task4Id, {isExpanded: true, childTasks: null}],
                                                ]),
                                            },
                                        ],
                                    ]),
                                },
                            ],
                        ]),
                    },
                ],
                [
                    task2aId,
                    {
                        isExpanded: true,
                        childTasks: new Map([
                            [
                                task3Id,
                                {
                                    isExpanded: true,
                                    childTasks: new Map([
                                        [task5Id, {isExpanded: true, childTasks: null}],
                                    ]),
                                },
                            ],
                        ]),
                    },
                ],
                [
                    task1bId,
                    {
                        isExpanded: true,
                        childTasks: new Map([[task2bId, {isExpanded: true, childTasks: null}]]),
                    },
                ],
                [task2bId, {isExpanded: true, childTasks: null}],
            ]),
            [task1aId, task2aId],
            [task1bId, task2bId],
            task3Id,
        ),
    ).toEqual(
        new Map([
            [
                task1aId,
                {
                    isExpanded: true,
                    childTasks: new Map([[task2aId, {isExpanded: true, childTasks: null}]]),
                },
            ],
            [
                task2aId,
                {
                    isExpanded: true,
                    childTasks: null,
                },
            ],
            [
                task1bId,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task2bId,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [
                                        task3Id,
                                        {
                                            isExpanded: true,
                                            childTasks: new Map([
                                                [task4Id, {isExpanded: true, childTasks: null}],
                                            ]),
                                        },
                                    ],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
            [
                task2bId,
                {
                    isExpanded: true,
                    childTasks: new Map([
                        [
                            task3Id,
                            {
                                isExpanded: true,
                                childTasks: new Map([
                                    [task5Id, {isExpanded: true, childTasks: null}],
                                ]),
                            },
                        ],
                    ]),
                },
            ],
        ]),
    );
});

test("when moving expansion state empty collapsed state is removed", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    expect(
        moveTaskGridViewExpansionTaskState(
            new Map([
                [
                    task3Id,
                    {
                        isExpanded: true,
                        childTasks: new Map([
                            [
                                task2Id,
                                {
                                    isExpanded: false,
                                    childTasks: new Map([
                                        [task1Id, {isExpanded: true, childTasks: null}],
                                    ]),
                                },
                            ],
                        ]),
                    },
                ],
            ]),
            [task3Id, task2Id],
            [],
            task1Id,
        ),
    ).toEqual(
        new Map([
            [task3Id, {isExpanded: true, childTasks: null}],
            [task1Id, {isExpanded: true, childTasks: null}],
        ]),
    );
});

test("won\u2019t expand final task to fit new expanded task state when moving", () => {
    const task1Id = generateId<TaskId>();
    const task2Id = generateId<TaskId>();
    const task3Id = generateId<TaskId>();

    expect(
        moveTaskGridViewExpansionTaskState(
            new Map([
                [
                    task1Id,
                    {
                        isExpanded: true,
                        childTasks: new Map([[task2Id, {isExpanded: true, childTasks: null}]]),
                    },
                ],
            ]),
            [task1Id],
            [task1Id, task3Id],
            task2Id,
        ),
    ).toEqual(new Map([[task1Id, {isExpanded: true, childTasks: null}]]));
});
