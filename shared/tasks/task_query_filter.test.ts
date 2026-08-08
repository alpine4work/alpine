import {
    deserializeTaskQueryFilters,
    serializeTaskQueryFilters,
} from "~/shared/tasks/task_query_filter.js";
import {taskQueryFilterTestCases} from "~/shared/tasks/test_helpers/task_query_filter_test_cases.js";

for (const {name, filters: filters1} of taskQueryFilterTestCases) {
    test(`${name}`, () => {
        const buffer1 = serializeTaskQueryFilters(filters1);
        const filters2 = deserializeTaskQueryFilters(new Uint8Array(buffer1));
        const buffer2 = serializeTaskQueryFilters(filters2);

        expect(filters1).toEqual(filters2);
        expect(buffer1).toEqual(buffer2);
    });
}

test("creator filter rejects missing account", () => {
    expect(() => deserializeTaskQueryFilters(new Uint8Array([129, 5, 65, 3]))).toThrow(
        "Assertion failure: `isTaskQueryFilterCreatorAccountOperation(operation)`",
    );
});
