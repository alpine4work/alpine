import {useEffect, useState} from "react";
import {ShouldRevalidateFunction} from "react-router";
import {useSearchParams} from "react-router-dom";
import {useTaskClientStoreSearchAffinityManager} from "~/app/helpers/use_task_client_store_search_entity_affinity_manager.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useTaskStoreLoaderDataWithoutRetaining} from "~/client/tasks/core/task_realtime_client_context_provider.js";
import {getTaskGridViewLoadQueryLimit} from "~/client/tasks/get_task_grid_view_load_query_limit.js";
import {TaskGridViewDndContext} from "~/client/tasks/task_grid_view_dnd_context.js";
import {taskNotepadAssigneeActiveLoadLimit} from "~/client/tasks/task_notepad_assignee_active_limit.js";
import {TaskNotepadView} from "~/client/tasks/task_notepad_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotepadPageIds} from "~/server/tasks/data/task_table.js";
import {NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {BrowserId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotepadPageId,
    TaskNotepadPageIdCompressedSet,
    TaskNotepadPageIdSchema,
} from "~/shared/tasks/task_notepad_page_id.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlySet,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

const LoaderSchema = Schema.object({
    key: Schema.id(),
    allNotepadPageIds: TaskNotepadPageIdCompressedSet.schema,
    initialNotepadPageId: TaskNotepadPageIdSchema,
    initialNotepadPageGridViewExpansionState: TaskGridViewExpansionStateSchema,
});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "Notepad"}]);

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const notepadPageIdParam = url.searchParams.get("page");

    const allNotepadPageIds = await getTaskNotepadPageIds(context, spaceId);

    const allNotepadPageUncompressedIds = allNotepadPageIds.get();

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
        limit: taskNotepadAssigneeActiveLoadLimit,

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
            key: generateId(),
            allNotepadPageIds,
            initialNotepadPageId: notepadPageId,
            initialNotepadPageGridViewExpansionState: notepadPageGridViewExpansionState,
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

// We don't need to reload when certain search params change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    nextUrl.searchParams.delete("focus");
    currentUrl.searchParams.delete("focus");

    nextUrl.searchParams.delete("show");
    currentUrl.searchParams.delete("show");

    return nextUrl.toString() !== currentUrl.toString();
};

export default function TasksRoute() {
    const [searchParams, setSearchParams] = useSearchParams();

    const {key, allNotepadPageIds, initialNotepadPageId, initialNotepadPageGridViewExpansionState} =
        useLoaderDataWithSchema(LoaderSchema);

    // We don't retain here since the components that consume our queries are
    // expected to retain them.
    const {
        store,
        queries: [assigneeActiveQuery, initialNotepadPageQuery],
    } = useTaskStoreLoaderDataWithoutRetaining();
    assert(assigneeActiveQuery && initialNotepadPageQuery);

    const affinityManager = useTaskClientStoreSearchAffinityManager("TaskNotepad");

    const [shouldInitiallyFocusTopGhostTask] = useState(searchParams.get("focus") === "new");
    const [shouldInitiallyShowTopGhostTask] = useState(searchParams.get("show") === "new");

    // Remove the `focus` search param.
    useEffect(() => {
        if (searchParams.has("focus") || searchParams.has("show")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("focus");
            newSearchParams.delete("show");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [searchParams, setSearchParams]);

    return (
        <TaskGridViewDndContext store={store}>
            <TaskNotepadView
                // Completely re-mount the route when we get new data from the server.
                key={key}
                store={store}
                assigneeActiveQuery={assigneeActiveQuery}
                affinityManager={affinityManager}
                initialQuery={{
                    query: initialNotepadPageQuery,
                    initialGridViewExpansionState: initialNotepadPageGridViewExpansionState,
                }}
                initialNotepadPageId={initialNotepadPageId}
                allNotepadPageIds={allNotepadPageIds}
                onActiveNotepadPageIdChange={notepadPageId => {
                    const newSearchParams = new URLSearchParams(searchParams);
                    newSearchParams.set("page", String(notepadPageId));

                    setSearchParams(newSearchParams, {
                        // Allow forward/back navigation across notepad pages.
                        //
                        // Except in our native mobile apps where we don't want to animate a new
                        // page onscreen.
                        replace: !!NativeMobileBridge,
                        unstable_shouldRevalidate: false,
                    });
                }}
                shouldInitiallyFocusTopGhostTask={shouldInitiallyFocusTopGhostTask}
                shouldInitiallyShowTopGhostTask={shouldInitiallyShowTopGhostTask}
            />
        </TaskGridViewDndContext>
    );
}
