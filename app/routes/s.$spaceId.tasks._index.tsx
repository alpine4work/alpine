import {useMemo} from "react";
import {Params} from "react-router";
import {Box} from "~/client/design/box.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {TaskGridView} from "~/client/tasks/task_grid_view.js";
import {
    clientLoaderLoadTaskQueryData,
    useTaskClientStore,
} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotepadPageIds} from "~/server/tasks/data/task_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskClientQueryId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedObjectValue} from "~/shared/schema/schema.js";
import {TaskNotepadPageIdCompressedSetSchema} from "~/shared/tasks/task_notepad_page_id.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlySet,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

const LoaderSchema = Schema.object({
    notepadPageIds: TaskNotepadPageIdCompressedSetSchema,
    assigneeActiveQueryId: Schema.id<TaskClientQueryId>(),
    notepadPageQueryId: Schema.id<TaskClientQueryId>(),
    initialBottomGhostTaskId: Schema.id<TaskId>(),
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

    const assigneeActiveQueryId = generateId<TaskClientQueryId>();
    const notepadPageQueryId = generateId<TaskClientQueryId>();

    return jsonWithSchema(
        LoaderSchema,
        {
            notepadPageIds,
            assigneeActiveQueryId,
            notepadPageQueryId,
            initialBottomGhostTaskId: generateId<TaskId>(),
        },
        {
            propagateEventData: {
                context: {
                    taskNotepadPageId: latestNotepadPageId,
                },
            },
            loadTaskQueryData: {
                queries: [
                    {
                        id: assigneeActiveQueryId,
                        filters: assigneeActiveQuery.filters,
                        sorts: assigneeActiveQuery.sorts,
                        loadedState: assigneeActiveQueryLoadedState,
                    },
                    {
                        id: notepadPageQueryId,
                        filters: notepadPageQuery.filters,
                        sorts: notepadPageQuery.sorts,
                        loadedState: notepadPageQueryLoadedState,
                    },
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
    const {notepadPageQueryId, initialBottomGhostTaskId} = useLoaderDataWithSchema(LoaderSchema);

    const store = useTaskClientStore();

    // NOCOMMIT: Is this actually the right API for this? What if the query
    // reference changes? How do we make sure the query stays subscribed? I'm not
    // even sure we should have query IDs! Maybe we should subscribe with
    // filters/sorts?
    const query = store.getQuery(notepadPageQueryId);

    // NOCOMMIT: This should be in a lower-level component I think but let's start
    // here since I want the background color.
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
                store={store}
                query={query}
                initialBottomGhostTaskId={initialBottomGhostTaskId}
            />
        </Box>
    );
}
