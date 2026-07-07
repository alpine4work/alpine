import fc from "fast-check";
import {
    parseAgentWebTaskFilters,
    printAgentWebTaskFilters,
} from "~/server/agents/web/agent_web_task_filters.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    fromApiFilter,
    intoApiFilter,
} from "~/shared/api/content/closed_source/into_api_task_filter.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFiltersArbitrary} from "~/shared/tasks/test_helpers/task_query_filter_arbitrary.js";

import.meta.jest.setTimeout(20 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 15 * 1000});

const storage = createAgentWebSessionStorageForTest(generateId<SpaceId>());

test("all possible task query filters round trip through agent web search params", async () => {
    await fc.assert(
        fc.asyncProperty(TaskQueryFiltersArbitrary, async taskQueryFilters => {
            await createTaskFilterLinksForTest(taskQueryFilters);

            const apiFilters = taskQueryFilters.map(intoApiFilter);
            const searchParamsString = await printAgentWebTaskFilters(storage, apiFilters);

            // Run the printed search params through the same path normalization the agent web
            // `read` tool uses so we know a real read preserves every filter.
            const {searchParams} = normalizeAgentWebPath(
                `/task-collection/all?${searchParamsString}`,
            );

            const parsedApiFilters = await parseAgentWebTaskFilters(storage, searchParams);

            expect(parsedApiFilters.map(fromApiFilter)).toEqual(taskQueryFilters);
        }),
        {
            // Run until we reach our 15s timeout.
            numRuns: Infinity,
        },
    );
});

/**
 * `printAgentWebTaskFilters()` requires a stored link for every account and task
 * collection referenced by a filter, just like a real task collection page which
 * links every reference it shows.
 */
async function createTaskFilterLinksForTest(
    filters: ReadonlyArray<TaskQueryFilter>,
): Promise<void> {
    const accountIds = new Set<AccountId>();
    const collectionIds = new Set<TaskCollectionId>();

    for (const filter of filters) {
        if (filter.type === "Collections" && filter.operation.type !== "IsEmpty") {
            for (const collectionId of filter.operation.collectionIds) {
                collectionIds.add(collectionId);
            }
        }

        if (filter.type === "Assignee" || filter.type === "Creator" || filter.type === "Assigner") {
            for (const account of filter.operation.accounts) {
                if (account.type === "Account") accountIds.add(account.accountId);
            }
        }
    }

    await runAllPromises(
        concatIterables(
            mapIterable(accountIds, accountId =>
                createAgentWebPageStoredLinkPathname(storage, {
                    type: "Account",
                    id: accountId,
                    // Use the ID as the account name so generated accounts don't collide with reserved
                    // filter values like `me` and `none`.
                    //
                    // Reverse the ID and only take the first 10 characters so we test the title wasn't
                    // obviously dervied from the ID in the implementation.
                    title: accountId.slice(0, 10).split("").reverse().join(""),
                    shortName: accountId.slice(0, 10).split("").reverse().join(""),
                }),
            ),
            mapIterable(collectionIds, collectionId =>
                createAgentWebPageStoredLinkPathname(storage, {
                    type: "TaskCollection",
                    id: collectionId,
                    title: collectionId.slice(0, 10).split("").reverse().join(""),
                }),
            ),
        ),
    );
}
