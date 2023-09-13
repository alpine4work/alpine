import {useEffect, useMemo} from "react";
import {Params} from "react-router";
import {Box} from "~/client/design/box.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskGridView} from "~/client/tasks/task_grid_view.js";
import {
    clientLoaderLoadTaskQueryData,
    useLoaderTaskQueriesWithoutRetaining,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotepadPageIds} from "~/server/tasks/data/task_table.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotepadPageIdCompressedSetSchema,
    TaskNotepadPageIdSchema,
} from "~/shared/tasks/task_notepad_page_id.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlySet,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

const LoaderSchema = Schema.object({
    allNotepadPageIds: TaskNotepadPageIdCompressedSetSchema,
    notepadPageId: TaskNotepadPageIdSchema,
    notepadPageViewExpandedState: TaskGridViewExpansionStateSchema,
    initialBottomGhostTaskId: Schema.id<TaskId>(),
});

export async function loader({params, context: _context}: LoaderArgs) {
    const context = (await _context.actor.authenticate()).actor.authorizeSession();

    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const allNotepadPageIds = await getTaskNotepadPageIds(context, spaceId);

    const allNotepadPageUncompressedIds = allNotepadPageIds.getIds();
    const firstNotepadPageStep = allNotepadPageUncompressedIds[Symbol.iterator]().next();
    assert(!firstNotepadPageStep.done);

    const notepadPageId = reduceIterable(
        allNotepadPageUncompressedIds,
        (notepadPageId1, notepadPageId2) =>
            notepadPageId2 > notepadPageId1 ? notepadPageId2 : notepadPageId1,
        firstNotepadPageStep.value,
    );

    // NOCOMMIT: Work on limits and loading next!
    //
    // console.log(
    //     getInitialVirtualizedScrollViewRenderedItemCount(
    //         context.loader.getClientInfo(),
    //         spacing[taskRowViewMinHeight],
    //     ),
    // );

    const assigneeActiveQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    } = {
        // NOCOMMIT: Proper limit?
        limit: 500,

        filters: {
            displayStatusFilter: {
                ifOpenInactive: false,
                ifOpenActive: true,
                ifClosed: false,
            },
            assigneeFilter: {
                type: "OneOf",
                accountIds: assertNonEmptyReadonlySet(new Set([context.actor.getAccountId()])),
            },
        },
        sorts: [
            {
                type: "AssigneeActivePosition",
                direction: "Descending",
                missing: "Last",
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],
    };

    const notepadPageQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
    } = {
        // NOCOMMIT: Proper limit?
        limit: 500,

        filters: {
            displayStatusFilter: {
                ifOpenInactive: true,
                ifOpenActive: true,
                ifClosed: true,
            },
            notepadPageFilter: {
                accountId: context.actor.getAccountId(),
                notepadPageId,
            },
        },
        sorts: [
            {
                type: "NotepadPagePosition",
                accountId: context.actor.getAccountId(),
                notepadPageId,
                direction: "Ascending",
                missing: "Last",
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ],

        shouldLoadGridViewExpandedChildTasksForBrowserId: context.loader.getBrowserId(),
    };

    const {loadedStates, gridViewExpansionStates, extraQueries, updateEvent} =
        await context.tasks.loadQueries(spaceId, [assigneeActiveQuery, notepadPageQuery]);

    const assigneeActiveQueryLoadedState = assertExists(loadedStates[0]);
    const notepadPageQueryLoadedState = assertExists(loadedStates[1]);

    const notepadPageViewExpandedState = gridViewExpansionStates[1] ?? null;

    return jsonWithSchema(
        LoaderSchema,
        {
            allNotepadPageIds,
            notepadPageId,
            notepadPageViewExpandedState,
            initialBottomGhostTaskId: generateId<TaskId>(),
        },
        {
            propagateEventData: {
                context: {
                    taskNotepadPageId: notepadPageId,
                },
            },
            loadTaskQueryData: {
                queries: [
                    {
                        desiredCount: assigneeActiveQuery.limit,
                        filters: assigneeActiveQuery.filters,
                        sorts: assigneeActiveQuery.sorts,
                        loadedState: assigneeActiveQueryLoadedState,
                    },
                    {
                        desiredCount: notepadPageQuery.limit,
                        filters: notepadPageQuery.filters,
                        sorts: notepadPageQuery.sorts,
                        loadedState: notepadPageQueryLoadedState,
                    },
                    ...extraQueries.map(query => ({
                        desiredCount: query.limit,
                        filters: query.filters,
                        sorts: query.sorts,
                        loadedState: query.loadedState,
                    })),
                ],
                updateEvent,
            },
        },
    );
}

export async function clientLoader({
    data,
    params,
}: {
    data: SchemaSerializedObjectValue;
    params: Params<string>;
}) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    clientLoaderLoadTaskQueryData(spaceId, data);
}

export default function TasksRoute() {
    const {notepadPageId, notepadPageViewExpandedState, initialBottomGhostTaskId} =
        useLoaderDataWithSchema(LoaderSchema);
    const [assigneeActiveQuery, notepadPageQuery] = useLoaderTaskQueriesWithoutRetaining();
    assert(assigneeActiveQuery && notepadPageQuery);

    // Retain our queries so they aren't destroyed after
    useEffect(() => {
        assigneeActiveQuery.retain();
        notepadPageQuery.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                batchStoreUpdates(() => {
                    assigneeActiveQuery.release();
                    notepadPageQuery.release();
                });
            });
        };
    }, [assigneeActiveQuery, notepadPageQuery]);

    const {currentAccount} = useSpaceContext();

    return (
        <Box flexGrow="1" overflow="hidden" backgroundColor="grey-0">
            <TaskGridView
                capabilities={useMemo(
                    () => ({
                        hasParentTaskTitle: false,
                        hasMultilineTitle: false,
                        hasColumns: true,
                        hasDenseFields: false,
                    }),
                    [],
                )}
                query={notepadPageQuery}
                initialExpandedState={notepadPageViewExpandedState}
                initialBottomGhostTaskId={initialBottomGhostTaskId}
                getAddNewTaskToQueryActions={(time, taskId, position) => {
                    let actualPosition: TaskPosition;
                    switch (position.type) {
                        case "End": {
                            actualPosition = {
                                orderTime: time,
                                orderKey: initialOrderKey,
                            };
                            break;
                        }
                        case "Above":
                        case "Below": {
                            const task1 = notepadPageQuery.getTaskSnapshot(position.taskId);

                            const cursor1 = getTaskQueryNormalizedSortCursorForModel(
                                notepadPageQuery.sorts,
                                task1,
                            );

                            const cursor2 =
                                position.type === "Above"
                                    ? notepadPageQuery.taskOrderStore.getSnapshot().lt(cursor1).key
                                    : notepadPageQuery.taskOrderStore.getSnapshot().gt(cursor1).key;

                            const task2 = cursor2
                                ? notepadPageQuery.getTaskSnapshot(
                                      getTaskQuerySortCursorTaskId(cursor2),
                                  )
                                : null;

                            const position1 = assertExists(
                                task1.rawData.positionByAccountIdAndNotepadPageId.get(
                                    `${currentAccount.id}-${notepadPageId}`,
                                ),
                            );

                            const position2 = task2
                                ? assertExists(
                                      task2.rawData.positionByAccountIdAndNotepadPageId.get(
                                          `${currentAccount.id}-${notepadPageId}`,
                                      ),
                                  )
                                : null;

                            const orderKey2 =
                                position2 &&
                                compareHybridLogicalTimes(
                                    position1.orderTime,
                                    position2.orderTime,
                                ) === 0
                                    ? position2.orderKey
                                    : null;

                            actualPosition = {
                                orderTime: position1.orderTime,
                                orderKey:
                                    position.type === "Above"
                                        ? generateOrderKeyBetween(orderKey2, position1.orderKey)
                                        : generateOrderKeyBetween(position1.orderKey, orderKey2),
                            };
                            break;
                        }
                        default:
                            throw exhaustive(position);
                    }

                    return [
                        {
                            type: "UpdateTask",
                            time,
                            taskId,
                            taskAction: {
                                type: "UpdateNotepadPagePosition",
                                accountId: currentAccount.id,
                                notepadPageId,
                                position: actualPosition,
                            },
                        },
                    ];
                }}
                getMaybeRemoveTaskFromQueryWhenNestingActions={(time, taskId) => [
                    {
                        type: "UpdateTask",
                        time,
                        taskId,
                        taskAction: {
                            type: "UpdateNotepadPagePosition",
                            accountId: currentAccount.id,
                            notepadPageId,
                            position: null,
                        },
                    },
                ]}
            />
        </Box>
    );
}
