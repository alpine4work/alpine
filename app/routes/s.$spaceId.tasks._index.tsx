import {json} from "@remix-run/server-runtime";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getTaskNotepadPageIds} from "~/server/tasks/data/task_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {assertNonEmptyReadonlySet} from "~/shared/tasks/task_query_normalized_filters.js";

export async function loader({params, context: _context}: LoaderArgs) {
    const context = (await _context.actor.authenticate()).actor.authorizeSession();

    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const notepadPageIds = await getTaskNotepadPageIds(context, spaceId);

    const firstNotepadPageStep = notepadPageIds[Symbol.iterator]().next();
    assert(!firstNotepadPageStep.done);

    const latestNotepadPageId = reduceIterable(
        notepadPageIds,
        (notepadPageId1, notepadPageId2) =>
            notepadPageId2 > notepadPageId1 ? notepadPageId2 : notepadPageId1,
        firstNotepadPageStep.value,
    );

    const {loadedStates, updateEvent} = await context.tasks.loadQueries(spaceId, [
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
    ]);

    // NOCOMMIT: Return this to the client
    console.log({notepadPageIds, loadedStates, updateEvent});

    return json({});
}

export default function TasksRoute() {
    return <>Hello, world!</>;
}
