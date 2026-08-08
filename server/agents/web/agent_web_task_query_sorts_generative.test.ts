import fc from "fast-check";
import {
    parseAgentWebTaskQuerySorts,
    printAgentWebTaskQuerySorts,
} from "~/server/agents/web/agent_web_task_query_sorts.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.open_source.js";
import {intoApiTaskQuerySort} from "~/shared/api/content/closed_source/into_api_task_query_sort.js";
import {TaskQuerySortsArbitrary} from "~/shared/tasks/test_helpers/task_query_sort_arbitrary.js";

import.meta.jest.setTimeout(10 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 5 * 1000});

test("all possible task query sorts round trip through agent web search params", () => {
    fc.assert(
        fc.property(TaskQuerySortsArbitrary, taskQuerySorts => {
            const apiSorts = taskQuerySorts.map(intoApiTaskQuerySort);

            const searchParamsString = printAgentWebTaskQuerySorts(apiSorts);

            // Run the printed search params through the same path normalization the agent web
            // `read` tool uses so we know a real read preserves every sort.
            const {searchParams} = normalizeAgentWebPath(
                `/task-collection/all?${searchParamsString}`,
            );

            const parsedApiSorts = parseAgentWebTaskQuerySorts(searchParams);

            expect(parsedApiSorts).toEqual(apiSorts);
        }),
        {
            // Run until we reach our 5s timeout.
            numRuns: Infinity,
        },
    );
});
