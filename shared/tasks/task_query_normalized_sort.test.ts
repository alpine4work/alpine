import {
    defaultTaskQueryNormalizedSorts,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";

test("default normalized sorts are correct", () => {
    expect(normalizeTaskQuerySorts([])).toEqual(defaultTaskQueryNormalizedSorts);
});
