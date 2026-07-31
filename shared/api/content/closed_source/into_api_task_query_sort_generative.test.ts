import fc from "fast-check";
import {
    fromApiTaskQuerySort,
    intoApiTaskQuerySort,
} from "~/shared/api/content/closed_source/into_api_task_query_sort.js";
import {TaskQuerySortsArbitrary} from "~/shared/tasks/test_helpers/task_query_sort_arbitrary.js";

import.meta.jest.setTimeout(10 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 5 * 1000});

test("all possible task query sorts round trip through the public API sort shape", () => {
    fc.assert(
        fc.property(TaskQuerySortsArbitrary, sorts => {
            expect(sorts.map(intoApiTaskQuerySort).map(fromApiTaskQuerySort)).toEqual(sorts);
        }),
        {
            // Run until we reach our 5s timeout.
            numRuns: Infinity,
        },
    );
});
