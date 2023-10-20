import {useEffect} from "react";
import {Params} from "react-router";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskNotepadView} from "~/client/tasks/task_notepad_view.js";
import {
    clientLoaderTaskStoreLoaderData,
    useTaskClientStore,
    useTaskStoreLoaderDataWithoutRetaining,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotepadPageIds} from "~/server/tasks/data/task_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {BrowserId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotepadPageId,
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
    initialNotepadPageId: TaskNotepadPageIdSchema,
    initialNotepadPageGridViewExpansionState: TaskGridViewExpansionStateSchema,
    initialBottomGhostTaskId: Schema.id<TaskId>(),
});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "Notepad"}]);

export async function loader({request, params, context: _context}: LoaderArgs) {
    const context = (await _context.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const notepadPageIdParam = url.searchParams.get("page");

    const allNotepadPageIds = await getTaskNotepadPageIds(context, spaceId);

    const allNotepadPageUncompressedIds = allNotepadPageIds.getIds();

    let notepadPageId: TaskNotepadPageId;

    if (notepadPageIdParam) {
        const notepadPageIdInt = parseInt(notepadPageIdParam, 10) as TaskNotepadPageId;

        if (!allNotepadPageUncompressedIds.has(notepadPageIdInt)) {
            throw new NotFoundError("Task notepad page not found");
        }

        notepadPageId = notepadPageIdInt;
    } else {
        const firstNotepadPageStep = allNotepadPageUncompressedIds[Symbol.iterator]().next();
        assert(!firstNotepadPageStep.done);

        notepadPageId = reduceIterable(
            allNotepadPageUncompressedIds,
            (notepadPageId1, notepadPageId2) =>
                notepadPageId2 > notepadPageId1 ? notepadPageId2 : notepadPageId1,
            firstNotepadPageStep.value,
        );
    }

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

    const {queries, extraQueries, updateEvent} = await context.tasks.loadQueries(spaceId, {
        queries: [assigneeActiveQuery, notepadPageQuery],
        taskIds: [],
        collectionIds: [],
    });

    const assigneeActiveQueryLoadedState = assertExists(queries[0]).loadedState;
    const notepadPageQueryLoadedState = assertExists(queries[1]).loadedState;

    const notepadPageGridViewExpansionState = queries[1]?.gridViewExpansionState ?? null;

    return jsonWithSchema(
        LoaderSchema,
        {
            allNotepadPageIds,
            initialNotepadPageId: notepadPageId,
            initialNotepadPageGridViewExpansionState: notepadPageGridViewExpansionState,
            initialBottomGhostTaskId: generateId<TaskId>(),
        },
        {
            propagateEventData: {
                context: {
                    taskNotepadPageId: notepadPageId,
                },
            },
            taskStoreLoaderData: {
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
                taskIds: [],
                collectionIds: [],
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

    clientLoaderTaskStoreLoaderData(spaceId, data);
}

export default function TasksRoute() {
    const store = useTaskClientStore();

    const {
        allNotepadPageIds,
        initialNotepadPageId,
        initialNotepadPageGridViewExpansionState,
        initialBottomGhostTaskId,
    } = useLoaderDataWithSchema(LoaderSchema);
    const {
        queries: [assigneeActiveQuery, initialNotepadPageQuery],
    } = useTaskStoreLoaderDataWithoutRetaining();
    assert(assigneeActiveQuery && initialNotepadPageQuery);

    // Retain our `assigneeActiveQuery` so it isn't destroyed while we're
    // using it. But we don't retain `initialNotepadPageQuery`! Instead
    // `initialNotepadPageQuery` is retained by `<TaskNotepadView>`. That way when
    // the query changes we can release the query and retain a new one.
    useEffect(() => {
        assigneeActiveQuery.retain();

        return () => {
            // Release after a microtask in case the component is re-rendering which will
            // synchronously call `retain()` again.
            scheduleMicrotask(() => {
                batchStoreUpdates(() => {
                    assigneeActiveQuery.release();
                });
            });
        };
    }, [assigneeActiveQuery]);

    return (
        <TaskNotepadView
            store={store}
            initialQuery={{
                query: initialNotepadPageQuery,
                initialGridViewExpansionState: initialNotepadPageGridViewExpansionState,
                initialBottomGhostTaskId,
            }}
            initialNotepadPageId={initialNotepadPageId}
            allNotepadPageIds={allNotepadPageIds}
            onNotepadPageIdChange={notepadPageId => {
                const url = new URL(window.location.href);

                url.searchParams.set("page", String(notepadPageId));

                // Silently update the URL without telling Remix so our component doesn't
                // re-render unnecessarily.
                window.history.replaceState(null, "", url);
            }}
        />
    );
}
