import fc from "fast-check";
import {
    deserializeTaskQuerySorts,
    serializeTaskQuerySorts,
} from "~/shared/tasks/task_query_sort.js";
import {TaskQuerySortsArbitrary} from "~/shared/tasks/test_helpers/task_query_sort_arbitrary.js";

import.meta.jest.setTimeout(10 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 5 * 1000});

test("all possible task query sorts round trip through binary serialization", () => {
    fc.assert(
        fc.property(TaskQuerySortsArbitrary, sorts => {
            const bytes = new Uint8Array(serializeTaskQuerySorts(sorts));
            expect(deserializeTaskQuerySorts(bytes)).toEqual(sorts);
        }),
        {
            // Run until we reach our 5s timeout.
            numRuns: Infinity,
        },
    );
});
