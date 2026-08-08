import fc from "fast-check";
import {
    parseAgentWebTaskQueryFilters,
    printAgentWebTaskQueryFilters,
} from "~/server/agents/web/agent_web_task_query_filters.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    fromApiTaskQueryFilter,
    intoApiTaskQueryFilter,
} from "~/shared/api/content/closed_source/into_api_task_query_filter.js";
import {
    ApiTaskQueryFilter,
    ApiTaskQueryFilterResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {Id, generateId} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TaskQueryFiltersArbitrary} from "~/shared/tasks/test_helpers/task_query_filter_arbitrary.js";

import.meta.jest.setTimeout(20 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 15 * 1000});

const addedTime = serializeDateString(new Date());

const storage = createAgentWebSessionStorageForTest(generateId<SpaceId>());

test("all possible task query filters round trip through agent web search params", async () => {
    await fc.assert(
        fc.asyncProperty(TaskQueryFiltersArbitrary, async taskQueryFilters => {
            const apiFilters = taskQueryFilters
                .map(intoApiTaskQueryFilter)
                .map(hydrateApiTaskQueryFilterForTest);

            const searchParamsString = await printAgentWebTaskQueryFilters(storage, apiFilters);

            // Run the printed search params through the same path normalization the agent web
            // `read` tool uses so we know a real read preserves every filter.
            const {searchParams} = normalizeAgentWebPath(
                `/task-collection/all?${searchParamsString}`,
            );

            const parsedApiFilters = await parseAgentWebTaskQueryFilters(storage, searchParams);

            expect(parsedApiFilters.map(fromApiTaskQueryFilter)).toEqual(taskQueryFilters);
        }),
        {
            // Run until we reach our 15s timeout.
            numRuns: Infinity,
        },
    );
});

/**
 * Create a name for an account or task collection from its ID. Generated names
 * never collide with reserved filter values like `me` and `none`.
 *
 * Reverse the ID and only take the first 10 characters so we test the name wasn't
 * obviously derived from the ID in the implementation.
 */
function createNameFromIdForTest(id: Id): string {
    return id.slice(0, 10).split("").reverse().join("");
}

/**
 * `printAgentWebTaskQueryFilters()` takes task filter responses with hydrated
 * account and task collection data which it uses to create agent web links on
 * demand.
 */
function hydrateApiTaskQueryFilterForTest(filter: ApiTaskQueryFilter): ApiTaskQueryFilterResponse {
    switch (filter.type) {
        case "Collections": {
            const {operation} = filter;
            if (operation.type === "IsEmpty") return {type: "Collections", operation};

            return {
                type: "Collections",
                operation: {
                    type: operation.type,
                    collections: operation.collections.map(collection => ({
                        id: collection.id,
                        name: createNameFromIdForTest(collection.id),
                    })),
                },
            };
        }
        case "Assignee":
        case "Assigner": {
            return {
                type: filter.type,
                operation: {
                    type: filter.operation.type,
                    accounts: filter.operation.accounts.map(account =>
                        account.type === "Account"
                            ? {
                                  type: "Account",
                                  account: {
                                      id: account.account.id,
                                      name: createNameFromIdForTest(account.account.id),
                                      shortName: createNameFromIdForTest(account.account.id),
                                      space: {role: "Member", addedTime},
                                  },
                              }
                            : account,
                    ),
                },
            };
        }
        case "Creator": {
            return {
                type: "Creator",
                operation: {
                    type: filter.operation.type,
                    accounts: filter.operation.accounts.map(account =>
                        account.type === "Account"
                            ? {
                                  type: "Account",
                                  account: {
                                      id: account.account.id,
                                      name: createNameFromIdForTest(account.account.id),
                                      shortName: createNameFromIdForTest(account.account.id),
                                      space: {role: "Member", addedTime},
                                  },
                              }
                            : account,
                    ),
                },
            };
        }
        default:
            return filter;
    }
}
