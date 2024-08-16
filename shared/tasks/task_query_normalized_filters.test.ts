import {today} from "@internationalized/date";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {
    defaultTaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";

test("default normalized filters are correct", () => {
    expect(
        normalizeTaskQueryFilters([], {
            currentAccountId: generateId(),
            currentDate: today(defaultTimeZone),
        }),
    ).toEqual({
        type: "Possible",
        normalizedFilters: defaultTaskQueryNormalizedFilters,
    });
});
