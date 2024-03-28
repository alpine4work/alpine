import {useDroppable} from "@dnd-kit/core";
import {Memo, useId} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {isTaskQueryManuallySorted} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskGridViewDroppableData} from "~/client/tasks/task_grid_view_dnd_context.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// So we assign the `Box` variable to null here so you get a TypeScript error
// if you try to use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

export function renderTaskRowViewDroppableIndentations({
    query,
    cursor,
    task,
    parents,
    nextIndentation,
    areChildTasksExpanded,
    getMoveTaskToRootQueryActions,
    setRowZIndex,
}: {
    query: TaskClientQuery;
    cursor: TaskQuerySortCursor;
    task: TaskModel;
    parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
    nextIndentation: number;
    areChildTasksExpanded: boolean;
    getMoveTaskToRootQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
    setRowZIndex: Memo<(zIndex: number) => () => void>;
}) {
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this component. It is critical for scroll performance that this component
    // renders fast. Use the `sprinkles()` function in the module body instead.
    // We've observed while profiling the sprinkles function takes a meaningful
    // amount of time during render.
    //
    // One day we'd like to introduce transformations that automatically
    // pre-evaluates `sprinkles()` functions at which point lifting them to the
    // module scope wouldn't do anything.
    //
    // So we assign the `sprinkles` variable to null here so you get a TypeScript
    // error if you try to use `sprinkles()`.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    if (areChildTasksExpanded && task.getChildTaskCount() > 0) {
        return (
            <TaskRowViewDroppable
                indentation={parents.length + 1}
                nextAdjacentIndentation={null}
                previousAdjacentIndentation={null}
                isVerticallyFlipped={true}
                setRowZIndex={setRowZIndex}
                getDropActions={(taskId): Array<TaskAction> => {
                    const time1 = query.store.clock.now();
                    const time2 = query.store.clock.now();

                    const childrenQuery = query.store
                        .getTaskChildrenQueryStore(task.id)
                        .getSnapshot();

                    return [
                        {
                            type: "UpdateTask",
                            time: time1,
                            taskId: taskId,
                            taskAction: {
                                type: "UpdateParentTaskId",
                                parentTaskId: task.id,
                            },
                        },
                        ...(childrenQuery
                            ? cast<Array<TaskAction>>([
                                  {
                                      type: "UpdateTask",
                                      time: time2,
                                      taskId: taskId,
                                      taskAction: {
                                          type: "UpdateParentPosition",
                                          parentPosition:
                                              getNewTaskPositionForQuerySortedByPosition(
                                                  time2,
                                                  childrenQuery,
                                                  {type: "Start"},
                                              ),
                                      },
                                  },
                              ])
                            : []),
                    ];
                }}
            />
        );
    }

    const droppableIndentations = [parents.length];

    for (
        let droppableIndentation = parents.length - 1;
        droppableIndentation >= nextIndentation;
        droppableIndentation--
    ) {
        // If our root query is auto-sorted then we can't drop our task there since we
        // can't set the task's position.
        if (droppableIndentation === 0) {
            const parent = parents[droppableIndentation]!;
            if (!isTaskQueryManuallySorted(parent.query.sorts)) break;
        }

        droppableIndentations.push(droppableIndentation);
    }

    droppableIndentations.reverse();

    return (
        <>
            {droppableIndentations.map((droppableIndentation, index) => (
                <TaskRowViewDroppable
                    key={droppableIndentation}
                    indentation={droppableIndentation}
                    nextAdjacentIndentation={droppableIndentations[index + 1] ?? null}
                    previousAdjacentIndentation={droppableIndentations[index - 1] ?? null}
                    setRowZIndex={setRowZIndex}
                    getDropActions={taskId => {
                        const time1 = query.store.clock.now();
                        const time2 = query.store.clock.now();

                        const {query: parentQuery, cursor: parentCursor} =
                            parents.length === droppableIndentation
                                ? {query, cursor}
                                : parents[droppableIndentation]!;

                        if (droppableIndentation === 0) {
                            return getMoveTaskToRootQueryActions(taskId, {
                                type: "Below",
                                taskId: getTaskQuerySortCursorTaskId(parentCursor),
                            });
                        }

                        const {cursor: grandParentCursor} = parents[droppableIndentation - 1]!;

                        return [
                            {
                                type: "UpdateTask",
                                time: time1,
                                taskId: taskId,
                                taskAction: {
                                    type: "UpdateParentTaskId",
                                    parentTaskId: getTaskQuerySortCursorTaskId(grandParentCursor),
                                },
                            },
                            {
                                type: "UpdateTask",
                                time: time2,
                                taskId: taskId,
                                taskAction: {
                                    type: "UpdateParentPosition",
                                    parentPosition: getNewTaskPositionForQuerySortedByPosition(
                                        time2,
                                        parentQuery,
                                        {
                                            type: "Below",
                                            taskId: getTaskQuerySortCursorTaskId(parentCursor),
                                        },
                                    ),
                                },
                            },
                        ];
                    }}
                />
            ))}
        </>
    );
}

const droppableContainerPositionedAboveClassName = sprinkles({
    position: "absolute",
    top: "-7",
    left: "0",
    right: "0",
    zIndex: "10",
    pointerEvents: "none",
    height: taskRowViewMinHeight,
});

const droppableContainerPositionedBelowClassName = sprinkles({
    position: "absolute",
    top: "3",
    bottom: "-3",
    left: "0",
    right: "0",
    zIndex: "10",
    pointerEvents: "none",
});

const droppableClassName = sprinkles({
    position: "absolute",
    left: "0",
    top: "0",
    bottom: "0",
});

const droppableHorizontalOverIndicatorClassName = sprinkles({
    position: "absolute",
    right: "5",
    bottom: "3",
    pointerEvents: "none",
    backgroundColor: {light: "theme-30", dark: "theme-60"},
});

const droppableVerticalOverIndicatorClassName = sprinkles({
    position: "absolute",
    bottom: "3",
    height: "2",
    backgroundColor: {light: "theme-30", dark: "theme-60"},
});

const droppableVerticalOverIndicatorFlippedClassName = sprinkles({
    position: "absolute",
    top: "7",
    height: "2",
    backgroundColor: {light: "theme-30", dark: "theme-60"},
});

export function TaskRowViewDroppable({
    indentation,
    nextAdjacentIndentation,
    previousAdjacentIndentation,
    isPositionedAbove,
    isVerticallyFlipped,
    getDropActions,
    setRowZIndex,
}: {
    indentation: number;
    nextAdjacentIndentation: number | null;
    previousAdjacentIndentation: number | null;
    isPositionedAbove?: boolean;
    isVerticallyFlipped?: boolean;
    getDropActions: (taskId: TaskId) => Array<TaskAction>;
    setRowZIndex: Memo<(zIndex: number) => () => void>;
}) {
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this component. It is critical for scroll performance that this component
    // renders fast. Use the `sprinkles()` function in the module body instead.
    // We've observed while profiling the sprinkles function takes a meaningful
    // amount of time during render.
    //
    // One day we'd like to introduce transformations that automatically
    // pre-evaluates `sprinkles()` functions at which point lifting them to the
    // module scope wouldn't do anything.
    //
    // So we assign the `sprinkles` variable to null here so you get a TypeScript
    // error if you try to use `sprinkles()`.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const {isOver, setNodeRef: setDroppableNodeRef} = useDroppable({
        id: useId(),
        data: cast<TaskGridViewDroppableData>({
            type: "Row",
            getDropActions,
        }),
    });

    const listItemIndent = parseRemLengthNumber(contentSchemaStyles.listItemIndentation);

    // If collections are expanded then make sure our task row renders on top of
    // all other task rows.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isOver) return;

        // Call `setRowZIndex` after a microtask since our parent effects need to run
        // before we can update the `z-index` on the correct row DOM node. If we don't
        // call in a microtask then we only set the `z-index` if this is not the row's
        // first render.
        let isCancelled = false;
        let unsetRowZIndex: (() => void) | null = null;
        scheduleMicrotask(() => {
            if (isCancelled) return;
            unsetRowZIndex = setRowZIndex(40);
        });

        return () => {
            isCancelled = true;
            unsetRowZIndex?.();
        };
    }, [isOver, setRowZIndex]);

    return (
        <div
            className={
                isPositionedAbove
                    ? droppableContainerPositionedAboveClassName
                    : droppableContainerPositionedBelowClassName
            }
        >
            <div
                ref={setDroppableNodeRef}
                className={droppableClassName}
                style={{
                    left:
                        previousAdjacentIndentation !== null
                            ? `${listItemIndent * indentation}rem`
                            : 0,
                    width:
                        nextAdjacentIndentation !== null && previousAdjacentIndentation !== null
                            ? `${
                                  listItemIndent *
                                  (nextAdjacentIndentation - previousAdjacentIndentation - 1)
                              }rem`
                            : nextAdjacentIndentation !== null
                            ? `${listItemIndent * nextAdjacentIndentation}rem`
                            : previousAdjacentIndentation !== null
                            ? `calc(100% - ${
                                  listItemIndent * (previousAdjacentIndentation + 1)
                              }rem)`
                            : "100%",
                }}
            />
            {isOver && (
                <div
                    className={droppableHorizontalOverIndicatorClassName}
                    style={{
                        height: 1,
                        left: `${
                            parseRemLengthNumber(spacing["5"]) + listItemIndent * indentation
                        }rem`,
                    }}
                />
            )}
            {isOver && (
                <div
                    className={
                        isVerticallyFlipped
                            ? droppableVerticalOverIndicatorFlippedClassName
                            : droppableVerticalOverIndicatorClassName
                    }
                    style={{
                        width: 1,
                        left: `${
                            parseRemLengthNumber(spacing["5"]) + listItemIndent * indentation
                        }rem`,
                    }}
                />
            )}
        </div>
    );
}
