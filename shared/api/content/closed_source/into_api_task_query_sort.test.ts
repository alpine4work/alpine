import {
    fromApiTaskQuerySort,
    intoApiTaskQuerySort,
} from "~/shared/api/content/closed_source/into_api_task_query_sort.js";
import {ApiTaskQuerySort} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {taskQuerySortTestCases} from "~/shared/tasks/test_helpers/task_query_sort_test_cases.js";

test("serializes status sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "DisplayStatus", direction: "Ascending"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "Status", direction: "Ascending"}),
    );
});

test("serializes priority sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Priority", direction: "Descending"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "Priority", direction: "Descending"}),
    );
});

test("serializes layout sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Layout", missing: "First"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "Layout", missing: "First"}),
    );
});

test("serializes assignee sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Assignee", missing: "Last"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "Assignee", missing: "Last"}),
    );
});

test("serializes creator sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Creator"};

    expect(intoApiTaskQuerySort(sort)).toEqual(cast<ApiTaskQuerySort>({type: "Creator"}));
});

test("serializes assigner sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Assigner", missing: "First"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "Assigner", missing: "First"}),
    );
});

test("serializes due sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "DueDate", direction: "Ascending"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "Due", direction: "Ascending"}),
    );
});

test("serializes created time sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "CreatedTime", direction: "Descending"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "CreatedTime", direction: "Descending"}),
    );
});

test("serializes assigned time sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "AssignedTime", direction: "Ascending"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "AssignedTime", direction: "Ascending"}),
    );
});

test("serializes closed time sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "ClosedTime", direction: "Descending"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "ClosedTime", direction: "Descending"}),
    );
});

test("serializes activated time sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "ActivatedTime", direction: "Ascending"};

    expect(intoApiTaskQuerySort(sort)).toEqual(
        cast<ApiTaskQuerySort>({type: "ActivatedTime", direction: "Ascending"}),
    );
});

test.each(taskQuerySortTestCases)("round trip: $name", ({sorts}) => {
    expect(sorts.map(sort => fromApiTaskQuerySort(intoApiTaskQuerySort(sort)))).toEqual(sorts);
});
