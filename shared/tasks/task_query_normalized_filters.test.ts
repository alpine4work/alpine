import {today} from "@internationalized/date";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {
    defaultTaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";

test("default normalized filters are correct", () => {
    expect(
        normalizeTaskQueryFilters([], {
            currentAccountId: generateId<AccountId>(),
            currentDate: today(defaultTimeZone),
        }),
    ).toEqual({
        type: "Possible",
        normalizedFilters: defaultTaskQueryNormalizedFilters,
    });
});
