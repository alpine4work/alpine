import {
    deserializeTaskQuerySorts,
    serializeTaskQuerySorts,
} from "~/shared/tasks/task_query_sort.js";
import {taskQuerySortTestCases} from "~/shared/tasks/test_helpers/task_query_sort_test_cases.js";

for (const {name, sorts: sorts1} of taskQuerySortTestCases) {
    test(`${name}`, () => {
        const buffer1 = serializeTaskQuerySorts(sorts1);
        const sorts2 = deserializeTaskQuerySorts(new Uint8Array(buffer1));
        const buffer2 = serializeTaskQuerySorts(sorts2);

        expect(sorts1).toEqual(sorts2);
        expect(buffer1).toEqual(buffer2);
    });
}
