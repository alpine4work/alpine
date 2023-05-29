import {CalendarDate} from "@internationalized/date";
import {Draft, castDraft, produce} from "immer";
import {Key, useMemo, useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_task_collection";
import {
    TaskCardPresentationalView,
    taskCardViewMaxWidth,
} from "~/client/tasks/demo_2/task_card_presentational_view";
import {TaskDetailPresentationalView} from "~/client/tasks/demo_2/task_detail_presentational_view";
import {
    TaskGridPresentationalView,
    TaskGridPresentationalViewRef,
} from "~/client/tasks/demo_2/task_grid_presentational_view";
import {TaskAssignee, TaskStatus} from "~/client/tasks/demo_2/task_status_button";
import {useTaskGhostRowPlaceholderTutorial} from "~/client/tasks/demo_2/use_task_ghost_row_placeholder_tutorial";
import {AccountModel} from "~/shared/accounts/account_model";
import {emptyContentReferences} from "~/shared/content/content_references";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {noop} from "~/shared/helpers/control/noop";
import {assertId} from "~/shared/id/id";
import {AccountId, LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {sprinkles} from "~/shared/styles/styles";
import {
    TaskNotesContentWithReferences,
    createSimpleTaskNotesContent,
    emptyTaskNotesContentWithReferences,
} from "~/shared/tasks/task_notes_content_schema";
import {TaskTitle, createSimpleTaskTitle, emptyTaskTitle} from "~/shared/tasks/task_title_schema";

export function meta() {
    return {
        title: `Tasks Design Playground${metaTitlePostfix}`,
    };
}

const account1 = new AccountModel({
    id: assertId<AccountId>("tep7a4qm9w80ccyhqh56cnf08c"),
    name: "Logan Roy",
    createdTime: new Date("2023-05-22T17:30:24.653Z"),
});

const account2 = new AccountModel({
    id: assertId<AccountId>("e12zp2m60pam4cf6k0ej4mttfc"),
    name: "Siobahn Roy",
    createdTime: new Date("2023-05-22T17:30:24.653Z"),
});

const account3 = new AccountModel({
    id: assertId<AccountId>("x3bekvne562ty8g5x9bb4eptj8"),
    name: "Kendall Roy",
    createdTime: new Date("2023-05-22T17:30:24.653Z"),
});

const account4 = new AccountModel({
    id: assertId<AccountId>("9khstzn60vzx2ee88pv8ym1dsg"),
    name: "Roman Roy",
    createdTime: new Date("2023-05-22T17:30:24.653Z"),
});

const kitchenTaskCollection: LocalTaskCollection = {
    id: assertId<LocalTaskCollectionId>("vxydptp0bf9zxnwm2gx38h2k7r"),
    name: "Kitchen",
    color: "blue",
};

const bathroomTaskCollection: LocalTaskCollection = {
    id: assertId<LocalTaskCollectionId>("vxydptp0bf9zxnwm2gx38h2k7r"),
    name: "Bathroom",
    color: "orange",
};

const bedroomTaskCollection: LocalTaskCollection = {
    id: assertId<LocalTaskCollectionId>("3144bjax5nacr3j1hwq4aj78ag"),
    name: "Bedroom",
    color: "pink",
};

export default function TasksDesignPlaygroundRoute() {
    const currentDate = useCurrentDate();

    const taskRowViews = (
        <Box backgroundColor="grey-0" border="grey-10" borderRadius="md" paddingY="5">
            <TaskGridDemoView
                initialTasks={[
                    {status: "Open", title: createSimpleTaskTitle("Test 1")},
                    {status: "Open", title: createSimpleTaskTitle("Test 2")},
                    {status: "Open", title: createSimpleTaskTitle("Test 3")},
                    {status: "Open", title: createSimpleTaskTitle("Test 4")},
                    {status: "Open", title: createSimpleTaskTitle("Test 5")},
                    {status: "Open", title: createSimpleTaskTitle("Test 6")},
                    {status: "Open", title: createSimpleTaskTitle("Test 7")},
                    {status: "Open", title: createSimpleTaskTitle("Test 8")},
                ]}
            />
        </Box>
    );

    const taskCardViews = (
        <Box display="flex" gap="4">
            <Box width="full" maxWidth="96" display="flex" flexDirection="column" gap="4">
                <TaskCardPresentationalView
                    status="Open"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle(
                        "Clean the kitchen: Wash the dishes, wipe down countertops, clean appliances (such as the oven and refrigerator), and sweep or mop the floor",
                    )}
                    assignee={{account: account4, status: "Active"}}
                    dueDate={currentDate.subtract({days: 1})}
                    collections={[kitchenTaskCollection]}
                />
                <TaskCardPresentationalView
                    status="Open"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle("Sort, wash, dry, and fold clothes")}
                    assignee={null}
                    dueDate={currentDate.add({days: 7})}
                    collections={[kitchenTaskCollection, bathroomTaskCollection]}
                />
            </Box>
            <Box width="full" maxWidth="96" display="flex" flexDirection="column" gap="4">
                <TaskCardPresentationalView
                    status="Closed"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle("Vacuum and mop floors")}
                    assignee={{account: account2, status: "Inactive"}}
                    dueDate={null}
                    collections={[]}
                />
            </Box>
        </Box>
    );

    const taskDetailViewNextToCardViews = (
        <Box display="flex" justifyContent="space-between" gap="4">
            <Box
                backgroundColor="grey-0"
                flexShrink="0"
                width="192"
                style={{height: "56rem"}}
                boxShadow="elevation-5"
                borderRadius="lg"
                overflow="hidden"
            >
                <TaskDetailDemoView
                    initialStatus="Open"
                    initialTitle={createSimpleTaskTitle(
                        "Clean the kitchen: Wash the dishes, wipe down countertops, clean appliances (such as the oven and refrigerator), and sweep or mop the floor",
                    )}
                    initialAssignee={{account: account4, status: "Inactive"}}
                    initialDueDate={currentDate}
                    initialCollections={[kitchenTaskCollection]}
                    initialNotesContent={{
                        doc: createSimpleTaskNotesContent(
                            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nunc rhoncus ex et ex pulvinar viverra. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Nam volutpat at lectus non cursus. Proin quis eros nulla. Donec turpis ante, egestas eget elementum eget, mollis eu nibh. Praesent ligula ipsum, malesuada non mauris sed, egestas pulvinar ipsum. Donec ut nulla eget ex efficitur varius tincidunt eu augue. Donec sit amet risus id nisl sodales varius. Suspendisse ligula magna, venenatis id porta non, ullamcorper vestibulum justo. Fusce facilisis purus vitae augue gravida, eleifend dictum metus varius. Phasellus lacinia vestibulum ex. Donec a pulvinar orci.",
                        ),
                        references: emptyContentReferences,
                    }}
                />
            </Box>
            <Box
                flexGrow="1"
                overflow="hidden"
                padding="1"
                margin="-1"
                display="flex"
                flexDirection="column"
                gap="4"
            >
                <TaskCardPresentationalView
                    status="Closed"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle(
                        "Clean out the fridge: Remove expired items and wipe shelves",
                    )}
                    assignee={{account: account3, status: "Inactive"}}
                    dueDate={currentDate}
                    collections={[kitchenTaskCollection]}
                />
                <TaskCardPresentationalView
                    status="Open"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle("Clean windows and mirrors")}
                    assignee={{account: account3, status: "Active"}}
                    dueDate={currentDate.add({days: 1})}
                    collections={[bathroomTaskCollection, kitchenTaskCollection]}
                />
                <TaskCardPresentationalView
                    status="Open"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle(
                        "Deep clean the kitchen: Remove all items from the countertops and wipe them down. Scrub the sink, faucet, and stovetop using appropriate cleaners. Clean the oven, inside and out, by following the manufacturer's instructions. Sweep and mop the floor, paying attention to corners and hard-to-reach areas",
                    )}
                    assignee={null}
                    dueDate={null}
                    collections={[kitchenTaskCollection]}
                />
                <TaskCardPresentationalView
                    status="Closed"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle("Tidy up the living room")}
                    assignee={null}
                    dueDate={currentDate.subtract({days: 7})}
                    collections={[]}
                />
                <TaskCardPresentationalView
                    status="Closed"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle("Declutter and organize")}
                    assignee={null}
                    dueDate={null}
                    collections={[]}
                />
                <TaskCardPresentationalView
                    status="Open"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle("Organize your closet")}
                    assignee={{account: account2, status: "Inactive"}}
                    dueDate={null}
                    collections={[bedroomTaskCollection]}
                />
                <TaskCardPresentationalView
                    status="Open"
                    onStatusChange={noop}
                    title={createSimpleTaskTitle(
                        "Remember to take breaks and reward yourself for your hard work!",
                    )}
                    assignee={{account: account1, status: "Inactive"}}
                    dueDate={currentDate.subtract({years: 2})}
                    collections={[]}
                />
            </Box>
        </Box>
    );

    const emptyTaskDetailView = (
        <Box
            backgroundColor="grey-0"
            flexShrink="0"
            width="192"
            style={{height: "56rem"}}
            boxShadow="elevation-5"
            borderRadius="lg"
            overflow="hidden"
        >
            <TaskDetailDemoView
                initialStatus="Open"
                initialTitle={emptyTaskTitle}
                initialAssignee={null}
                initialDueDate={null}
                initialCollections={[]}
                initialNotesContent={emptyTaskNotesContentWithReferences}
            />
        </Box>
    );

    const cardGap: Spacing = "3";
    const cardWidth = `calc(${(1 / 3) * 100}% - ${
        parseRemLengthNumber(spacing[cardGap]) * (2 / 3)
    }rem)`;

    const emptyActiveTasksWidget = (
        <Box
            backgroundColor="grey-0"
            boxShadow="elevation-5"
            borderRadius="xl"
            overflow="hidden"
            padding="16"
        >
            <Box fontSize="200" fontStyle="semi-bold">
                Active tasks
            </Box>
            <Spacer space="3" />
            <Box display="flex" gap={cardGap}>
                <Box
                    height="24"
                    maxWidth={taskCardViewMaxWidth}
                    border="grey-5"
                    borderRadius="lg"
                    style={{width: cardWidth}}
                    padding="4"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <Box width="48" textAlign="center" color="grey-50">
                        Mark tasks you’re currently working on as active
                    </Box>
                </Box>
                <Box
                    height="24"
                    maxWidth={taskCardViewMaxWidth}
                    border="grey-5"
                    borderRadius="lg"
                    style={{width: cardWidth}}
                />
                <Box
                    height="24"
                    maxWidth={taskCardViewMaxWidth}
                    border="grey-5"
                    borderRadius="lg"
                    style={{width: cardWidth}}
                />
            </Box>
        </Box>
    );

    return (
        <SpaceRouteScrollView>
            <Box
                className={sprinkles({
                    display: "flex",
                    flexDirection: "column",
                    padding: "24",
                    gap: "64",
                })}
            >
                {taskRowViews}
                {taskCardViews}
                {taskDetailViewNextToCardViews}
                {emptyTaskDetailView}
                {emptyActiveTasksWidget}
            </Box>
        </SpaceRouteScrollView>
    );
}

type TaskGridDemoTask = {
    readonly id: Key;
    readonly title: TaskTitle;
    readonly status: TaskStatus;
    readonly areChildTasksCollapsed: boolean;
    readonly childTasks: ReadonlyArray<TaskGridDemoTask>;
};

/**
 * Simple ref object compatible with React `useRef()` that will not be frozen
 * by Immer.
 */
class MutableRefObjectClass<Value> {
    current: Value;

    constructor(current: Value) {
        this.current = current;
    }
}

function TaskGridDemoView({
    initialTasks,
}: {
    initialTasks: Array<{
        title: TaskTitle;
        status: TaskStatus;
        childTasks?: ReadonlyArray<TaskGridDemoTask>;
    }>;
}) {
    const gridViewRef = useRef<TaskGridPresentationalViewRef>(null);

    const [state, setState] = useState<{
        nextId: number;
        tasks: ReadonlyArray<TaskGridDemoTask>;
        effectRef: MutableRefObjectClass<
            ((gridView: TaskGridPresentationalViewRef) => void) | null
        >;
    }>({
        nextId: initialTasks.length,
        tasks: initialTasks.map((task, index) => ({
            id: index,
            ...task,
            areChildTasksCollapsed: false,
            childTasks: task.childTasks ?? [],
        })),
        effectRef: new MutableRefObjectClass(null),
    });

    useMemo(() => {
        const taskIds = new Set<Key>();

        const loop = (tasks: ReadonlyArray<TaskGridDemoTask>) => {
            for (const task of tasks) {
                assert(!taskIds.has(task.id), "Task IDs must be unique");
                taskIds.add(task.id);

                loop(task.childTasks);
            }
        };

        loop(state.tasks);
    }, [state.tasks]);

    const taskRows = useMemo(() => {
        const taskRows: Array<{indentation: number; task: TaskGridDemoTask}> = [];

        const loop = (indentation: number, tasks: ReadonlyArray<TaskGridDemoTask>) => {
            for (const task of tasks) {
                taskRows.push({indentation, task});
                if (!task.areChildTasksCollapsed) {
                    loop(indentation + 1, task.childTasks);
                }
            }
        };

        loop(0, state.tasks);

        return taskRows;
    }, [state.tasks]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.effectRef.current) return;
        const effect = state.effectRef.current;
        state.effectRef.current = null;
        effect(assertExists(gridViewRef.current));
    }, [state.effectRef]);

    const {taskGhostRowPlaceholder} = useTaskGhostRowPlaceholderTutorial(taskRows.length);

    return (
        <TaskGridPresentationalView<{indentation: number; task: TaskGridDemoTask}>
            ref={gridViewRef}
            taskGhostRowPlaceholder={taskGhostRowPlaceholder}
            taskRowCount={taskRows.length}
            getTaskRow={index => taskRows[index]!}
            nextTaskKey={state.nextId}
            getTaskKey={({task}) => task.id}
            getTaskStatus={({task}) => task.status}
            onTaskStatusChange={({task: {id: taskId}}, status) => {
                setState(state =>
                    produce(state, state => {
                        const loop = (tasks: Draft<ReadonlyArray<TaskGridDemoTask>>) => {
                            for (const task of tasks) {
                                if (task.id === taskId) {
                                    task.status = status;
                                    return true;
                                }

                                if (loop(task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop(state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
            getTaskTitle={({task}) => task.title}
            onTaskTitleChange={({task: {id: taskId}}, title) => {
                setState(state =>
                    produce(state, state => {
                        const loop = (tasks: Draft<ReadonlyArray<TaskGridDemoTask>>) => {
                            for (const task of tasks) {
                                if (task.id === taskId) {
                                    task.title = castDraft(title);
                                    return true;
                                }

                                if (loop(task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop(state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
            getTaskAssignee={() => null}
            getTaskChildTaskCount={({task}) => task.childTasks.length}
            getTaskAreChildTasksCollapsed={({task}) => task.areChildTasksCollapsed}
            onAreChildTasksCollapsedToggle={({task: {id: taskId}}) => {
                setState(state =>
                    produce(state, state => {
                        const loop = (tasks: Draft<ReadonlyArray<TaskGridDemoTask>>) => {
                            for (const task of tasks) {
                                if (task.id === taskId) {
                                    task.areChildTasksCollapsed = !task.areChildTasksCollapsed;
                                    return true;
                                }

                                if (loop(task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop(state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
            getTaskRowIndentation={({indentation}) => indentation}
            createTaskAbove={({task: {id: taskId}}) => {
                setState(state =>
                    produce(state, state => {
                        const loop = (tasks: Draft<ReadonlyArray<TaskGridDemoTask>>) => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === taskId) {
                                    tasks.splice(taskIndex, 0, {
                                        id: state.nextId++,
                                        title: castDraft(emptyTaskTitle),
                                        status: "Open",
                                        areChildTasksCollapsed: false,
                                        childTasks: [],
                                    });
                                    return true;
                                }

                                if (loop(task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop(state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
            createTaskBelowAndFocus={({task: {id: taskId}}) => {
                setState(state =>
                    produce(state, state => {
                        let taskRowIndex: number = 0;

                        const loop = (
                            isTaskCollapsed: boolean,
                            tasks: Draft<ReadonlyArray<TaskGridDemoTask>>,
                        ) => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === taskId) {
                                    tasks.splice(taskIndex + 1, 0, {
                                        id: state.nextId++,
                                        title: castDraft(emptyTaskTitle),
                                        status: "Open",
                                        areChildTasksCollapsed: false,
                                        childTasks: [],
                                    });

                                    if (!isTaskCollapsed) {
                                        const focusTaskRowIndex = taskRowIndex + 1;
                                        state.effectRef = new MutableRefObjectClass(gridView =>
                                            gridView.focusTaskRowTitleStart(focusTaskRowIndex),
                                        );
                                    }

                                    return true;
                                }

                                if (!isTaskCollapsed) taskRowIndex++;

                                if (
                                    loop(
                                        isTaskCollapsed || task.areChildTasksCollapsed,
                                        task.childTasks,
                                    )
                                ) {
                                    return true;
                                }
                            }

                            return false;
                        };

                        if (!loop(false, state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
            createTaskChildAndFocus={({task: {id: taskId}}) => {
                setState(state =>
                    produce(state, state => {
                        let taskRowIndex: number = 0;

                        const loop = (
                            isTaskCollapsed: boolean,
                            tasks: Draft<ReadonlyArray<TaskGridDemoTask>>,
                        ) => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === taskId) {
                                    task.childTasks.unshift({
                                        id: state.nextId++,
                                        title: castDraft(emptyTaskTitle),
                                        status: "Open",
                                        areChildTasksCollapsed: false,
                                        childTasks: [],
                                    });

                                    if (!isTaskCollapsed) {
                                        const focusTaskRowIndex = taskRowIndex + 1;
                                        state.effectRef = new MutableRefObjectClass(gridView =>
                                            gridView.focusTaskRowTitleStart(focusTaskRowIndex),
                                        );
                                    }

                                    return true;
                                }

                                if (!isTaskCollapsed) taskRowIndex++;

                                if (
                                    loop(
                                        isTaskCollapsed || task.areChildTasksCollapsed,
                                        task.childTasks,
                                    )
                                ) {
                                    return true;
                                }
                            }

                            return false;
                        };

                        if (!loop(false, state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
            createTaskAtEnd={title => {
                setState(state =>
                    produce(state, state => {
                        state.tasks.push({
                            id: state.nextId++,
                            title: castDraft(title),
                            status: "Open",
                            areChildTasksCollapsed: false,
                            childTasks: [],
                        });
                    }),
                );
            }}
            createTaskAtEndAndFocusGhost={title => {
                setState(state =>
                    produce(state, state => {
                        state.tasks.push({
                            id: state.nextId++,
                            title: castDraft(title),
                            status: "Open",
                            areChildTasksCollapsed: false,
                            childTasks: [],
                        });

                        state.effectRef = new MutableRefObjectClass(gridView =>
                            gridView.focusGhostTaskRow(),
                        );
                    }),
                );
            }}
            nestTaskAndExpandParentRow={({task: {id: parentTaskId}}, {task: {id: childTaskId}}) => {
                setState(state =>
                    produce(state, state => {
                        if (parentTaskId === childTaskId) {
                            throw new InvalidArgumentError("Can't nest task under itself");
                        }

                        const loop1 = (
                            tasks: Draft<ReadonlyArray<TaskGridDemoTask>>,
                        ): Draft<TaskGridDemoTask> | null => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === childTaskId) {
                                    tasks.splice(taskIndex, 1);
                                    return task;
                                }

                                const childTask = loop1(task.childTasks);
                                if (childTask) return childTask;
                            }

                            return null;
                        };

                        const childTask = loop1(state.tasks);
                        if (!childTask) {
                            throw new NotFoundError("Child task not found");
                        }

                        const loop2 = (tasks: Draft<ReadonlyArray<TaskGridDemoTask>>) => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === parentTaskId) {
                                    task.areChildTasksCollapsed = false;
                                    task.childTasks.push(childTask);
                                    return true;
                                }

                                if (loop2(task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop2(state.tasks)) {
                            throw new NotFoundError("Parent task not found");
                        }
                    }),
                );
            }}
            unnestTaskIfNestedRow={({task: {id: childTaskId}}) => {
                setState(state =>
                    produce(state, state => {
                        const loop = (
                            parent: {
                                tasks: Draft<ReadonlyArray<TaskGridDemoTask>>;
                                taskIndex: number;
                            } | null,
                            tasks: Draft<ReadonlyArray<TaskGridDemoTask>>,
                        ) => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === childTaskId) {
                                    if (parent) {
                                        tasks.splice(taskIndex, 1);
                                        parent.tasks.splice(parent.taskIndex + 1, 0, task);
                                    }
                                    return true;
                                }

                                if (loop({tasks, taskIndex}, task.childTasks)) return true;
                            }

                            return false;
                        };

                        if (!loop(null, state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
            deleteTaskAndAllChildrenAndFocusPreviousRow={({task: {id: taskId}}) => {
                setState(state =>
                    produce(state, state => {
                        let taskRowIndex: number = 0;

                        const loop = (
                            isTaskCollapsed: boolean,
                            tasks: Draft<ReadonlyArray<TaskGridDemoTask>>,
                        ) => {
                            for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                const task = tasks[taskIndex]!;

                                if (task.id === taskId) {
                                    tasks.splice(taskIndex, 1);

                                    if (!isTaskCollapsed) {
                                        if (tasks === state.tasks && tasks.length === 0) {
                                            state.effectRef = new MutableRefObjectClass(gridView =>
                                                gridView.focusGhostTaskRow(),
                                            );
                                        } else if (taskRowIndex === 0) {
                                            state.effectRef = new MutableRefObjectClass(gridView =>
                                                gridView.focusTaskRowTitleStart(0),
                                            );
                                        } else {
                                            const focusTaskRowIndex = taskRowIndex - 1;
                                            state.effectRef = new MutableRefObjectClass(gridView =>
                                                gridView.focusTaskRowTitleEnd(focusTaskRowIndex),
                                            );
                                        }
                                    }

                                    return true;
                                }

                                if (!isTaskCollapsed) taskRowIndex++;

                                if (
                                    loop(
                                        isTaskCollapsed || task.areChildTasksCollapsed,
                                        task.childTasks,
                                    )
                                ) {
                                    return true;
                                }
                            }

                            return false;
                        };

                        if (!loop(false, state.tasks)) {
                            throw new NotFoundError("Task not found");
                        }
                    }),
                );
            }}
        />
    );
}

function TaskDetailDemoView({
    initialStatus,
    initialTitle,
    initialAssignee,
    initialDueDate,
    initialCollections,
    initialNotesContent,
}: {
    initialStatus: TaskStatus;
    initialTitle: TaskTitle;
    initialAssignee: TaskAssignee | null;
    initialDueDate: CalendarDate | null;
    initialCollections: ReadonlyArray<LocalTaskCollection>;
    initialNotesContent: TaskNotesContentWithReferences;
}) {
    const [status, setStatus] = useState(initialStatus);
    const [title, setTitle] = useState(initialTitle);
    const [assignee] = useState(initialAssignee);
    const [dueDate, setDueDate] = useState(initialDueDate);
    const [collections] = useState(initialCollections);
    const [notesContent, setNotesContent] = useState(initialNotesContent);

    return (
        <TaskDetailPresentationalView
            status={status}
            onStatusChange={setStatus}
            title={title}
            onTitleChange={setTitle}
            assignee={assignee}
            dueDate={dueDate}
            onDueDateChange={setDueDate}
            collections={collections}
            notesContent={notesContent}
            onNotesContentChange={setNotesContent}
        />
    );
}
