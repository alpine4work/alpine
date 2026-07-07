import fc from "fast-check";
import {
    fromApiFilter,
    intoApiFilter,
} from "~/shared/api/content/closed_source/into_api_task_filter.js";
import {TaskQueryFiltersArbitrary} from "~/shared/tasks/test_helpers/task_query_filter_arbitrary.js";

import.meta.jest.setTimeout(10 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 5 * 1000});

test("all possible task query filters round trip through the public API filter shape", () => {
    fc.assert(
        fc.property(TaskQueryFiltersArbitrary, filters => {
            expect(filters.map(intoApiFilter).map(fromApiFilter)).toEqual(filters);
        }),
        {
            // Run until we reach our 5s timeout.
            numRuns: Infinity,
        },
    );
});
