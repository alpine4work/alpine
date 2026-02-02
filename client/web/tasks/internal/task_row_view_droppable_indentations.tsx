import {Memo} from "react";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/web/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {isTaskQueryManuallySorted} from "~/client/web/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskRowViewDroppable} from "~/client/web/tasks/internal/task_row_view_droppable.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars, react-refresh/only-export-components
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
    ) => {
        actions: Array<TaskActionModel>;
        position: TaskPosition;
    } | null;
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
                getDropActions={(taskId): Array<TaskActionModel> => {
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
                            ? cast<Array<TaskActionModel>>([
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
                            return (
                                getMoveTaskToRootQueryActions(taskId, {
                                    type: "Below",
                                    taskId: getTaskQuerySortCursorTaskId(parentCursor),
                                })?.actions ?? []
                            );
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
