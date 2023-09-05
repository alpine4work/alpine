import {Params} from "react-router";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {withTaskRealtimeClientForClient} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotepadPageIds} from "~/server/tasks/data/task_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskQueryModelId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {TaskNotepadPageIdCompressedSetSchema} from "~/shared/tasks/task_notepad_page_id.js";
import {
    TaskQueryNormalizedFilters,
    TaskQueryNormalizedFiltersSchema,
    assertNonEmptyReadonlySet,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    TaskQueryNormalizedSortSchema,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskRealtimeQueryLoadedStateSchema,
    TaskRealtimeUpdateEventSchema,
} from "~/shared/tasks/task_realtime_protocol.js";

const LoaderSchema = Schema.object({
    notepadPageIds: TaskNotepadPageIdCompressedSetSchema,
    assigneeActiveQuery: Schema.object({
        id: Schema.id<TaskQueryModelId>(),
        filters: TaskQueryNormalizedFiltersSchema,
        sorts: Schema.array(TaskQueryNormalizedSortSchema),
        loadedState: TaskRealtimeQueryLoadedStateSchema,
    }),
    notepadPageQuery: Schema.object({
        id: Schema.id<TaskQueryModelId>(),
        filters: TaskQueryNormalizedFiltersSchema,
        sorts: Schema.array(TaskQueryNormalizedSortSchema),
        loadedState: TaskRealtimeQueryLoadedStateSchema,
    }),
    updateEvent: TaskRealtimeUpdateEventSchema,
});

export async function loader({params, context: _context}: LoaderArgs) {
    const context = (await _context.actor.authenticate()).actor.authorizeSession();

    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const notepadPageIds = await getTaskNotepadPageIds(context, spaceId);

    const notepadPageUncompressedIds = notepadPageIds.getIds();
    const firstNotepadPageStep = notepadPageUncompressedIds[Symbol.iterator]().next();
    assert(!firstNotepadPageStep.done);

    const latestNotepadPageId = reduceIterable(
        notepadPageUncompressedIds,
        (notepadPageId1, notepadPageId2) =>
            notepadPageId2 > notepadPageId1 ? notepadPageId2 : notepadPageId1,
        firstNotepadPageStep.value,
    );

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
        ],
    };

    const notepadPageQuery: {
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
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
                notepadPageId: latestNotepadPageId,
            },
        },
        sorts: [
            {
                type: "NotepadPagePosition",
                accountId: context.actor.getAccountId(),
                notepadPageId: latestNotepadPageId,
                direction: "Ascending",
                missing: "Last",
            },
        ],
    };

    const {loadedStates, updateEvent} = await context.tasks.loadQueries(spaceId, [
        assigneeActiveQuery,
        notepadPageQuery,
    ]);

    const assigneeActiveQueryLoadedState = assertExists(loadedStates[0]);
    const notepadPageQueryLoadedState = assertExists(loadedStates[1]);

    return jsonWithSchema(
        LoaderSchema,
        {
            notepadPageIds,
            assigneeActiveQuery: {
                id: generateId<TaskQueryModelId>(),
                filters: assigneeActiveQuery.filters,
                sorts: assigneeActiveQuery.sorts,
                loadedState: assigneeActiveQueryLoadedState,
            },
            notepadPageQuery: {
                id: generateId<TaskQueryModelId>(),
                filters: notepadPageQuery.filters,
                sorts: notepadPageQuery.sorts,
                loadedState: notepadPageQueryLoadedState,
            },
            updateEvent,
        },
        {
            propagateEventData: {
                context: {
                    taskNotepadPageId: latestNotepadPageId,
                },
            },
        },
    );
}

export async function clientLoader({
    data: _data,
    params,
}: {
    data: SchemaSerializedObjectValue;
    params: Params<string>;
}) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const data = getLoaderDataWithSchema(LoaderSchema, _data);

    // NOCOMMIT: Is there a single render when navigating to a new page?
    withTaskRealtimeClientForClient(spaceId, client => {
        client.updateStore(store => {
            store = store.newQuery(data.assigneeActiveQuery.id, data.assigneeActiveQuery);
            store = store.newQuery(data.notepadPageQuery.id, data.notepadPageQuery);

            store = store.applyUpdateEvent(data.updateEvent);

            store = store.loadTasksIntoQuery(data.assigneeActiveQuery.id, {
                loadedState: data.assigneeActiveQuery.loadedState,
                previouslyBackfilledTaskIds: [],
            });

            store = store.loadTasksIntoQuery(data.notepadPageQuery.id, {
                loadedState: data.notepadPageQuery.loadedState,
                previouslyBackfilledTaskIds: [],
            });

            return store;
        });
    });
}

export default function TasksRoute() {
    const {notepadPageQuery} = useLoaderDataWithSchema(LoaderSchema);

    return <>Hello, world!</>;
}
