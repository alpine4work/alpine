import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotepadPageIds} from "~/server/tasks/data/task_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskNotepadPageIdCompressedSetSchema} from "~/shared/tasks/task_notepad_page_id.js";
import {
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlySet,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

const LoaderSchema = Schema.object({
    notepadPageIds: TaskNotepadPageIdCompressedSetSchema,
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

    const queries: Array<{
        limit: number;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }> = [
        // Active section query. All of an account's tasks that are assigned to them
        // and active. In the order the account has established for them.
        {
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
        },

        // Notepad page query. All of the tasks on this notepad page in the order the
        // account has established for them.
        {
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
        },
    ];

    const {loadedStates: queryLoadedStates, updateEvent} = await context.tasks.loadQueries(
        spaceId,
        queries,
    );

    return jsonWithSchema(
        LoaderSchema,
        {
            notepadPageIds,
        },
        {
            propagateEventData: {
                context: {
                    taskNotepadPageId: latestNotepadPageId,
                },
            },
            taskStoreData: {
                queries,
                queryLoadedStates,
                updateEvent,
            },
        },
    );
}

export default function TasksRoute() {
    console.log(useLoaderDataWithSchema(LoaderSchema));

    return <>Hello, world!</>;
}
