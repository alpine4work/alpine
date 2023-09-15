import {useEffect, useMemo} from "react";
import {Params} from "react-router";
import {Box} from "~/client/design/box.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskGridView} from "~/client/tasks/task_grid_view.js";
import {
    clientLoaderLoadTaskQueryData,
    useLoaderTaskQueriesWithoutRetaining,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotepadPageIds} from "~/server/tasks/data/task_table.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotepadPageIdCompressedSetSchema,
    TaskNotepadPageIdSchema,
} from "~/shared/tasks/task_notepad_page_id.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlySet,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

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

    const assigneeActiveQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    } = {
        limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),

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
        limit: getTaskGridViewLoadQueryLimit(context.loader.getClientInfo()),

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
                        limit: assigneeActiveQuery.limit,
                        filters: assigneeActiveQuery.filters,
                        sorts: assigneeActiveQuery.sorts,
                        loadedState: assigneeActiveQueryLoadedState,
                    },
                    {
                        limit: notepadPageQuery.limit,
                        filters: notepadPageQuery.filters,
                        sorts: notepadPageQuery.sorts,
                        loadedState: notepadPageQueryLoadedState,
                    },
                    ...extraQueries,
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
                        hasParentTaskTitle: true,
                        hasMultilineTitle: false,
                        hasColumns: true,
                        hasDenseFields: false,
                    }),
                    [],
                )}
                query={notepadPageQuery}
                initialExpandedState={notepadPageViewExpandedState}
                initialBottomGhostTaskId={initialBottomGhostTaskId}
                getMoveTaskToQueryActions={(taskId, position) => {
                    const time = notepadPageQuery.store.clock.now();
                    return [
                        {
                            type: "UpdateTask",
                            time,
                            taskId,
                            taskAction: {
                                type: "UpdateNotepadPagePosition",
                                accountId: currentAccount.id,
                                notepadPageId,
                                position: getNewTaskPositionForQuerySortedByPosition(
                                    time,
                                    notepadPageQuery,
                                    position,
                                ),
                            },
                        },
                    ];
                }}
                getMaybeRemoveTaskFromQueryWhenNestingActions={taskId => [
                    {
                        type: "UpdateTask",
                        time: notepadPageQuery.store.clock.now(),
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
