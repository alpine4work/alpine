import fc from "fast-check";
import {
    deserializeTaskQueryFilters,
    serializeTaskQueryFilters,
} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFiltersArbitrary} from "~/shared/tasks/test_helpers/task_query_filter_arbitrary.js";

import.meta.jest.setTimeout(10 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 5 * 1000});

test("all possible task query filters round trip through binary serialization", () => {
    fc.assert(
        fc.property(TaskQueryFiltersArbitrary, filters => {
            const bytes = new Uint8Array(serializeTaskQueryFilters(filters));
            expect(deserializeTaskQueryFilters(bytes)).toEqual(filters);
        }),
        {
            // Run until we reach our 5s timeout.
            numRuns: Infinity,
        },
    );
});
