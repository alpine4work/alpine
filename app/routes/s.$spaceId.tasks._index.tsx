import {Params} from "react-router";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {clientLoaderLoadTaskQueryData} from "~/client/tasks/task_realtime_client_context_provider.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotepadPageIds} from "~/server/tasks/data/task_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskClientQueryId} from "~/shared/id/types/id_types.js";
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
    const {notepadPageQueryId} = useLoaderDataWithSchema(LoaderSchema);

    return <>Hello, world!</>;
}
