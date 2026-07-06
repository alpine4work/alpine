import {fromApiSort, intoApiSort} from "~/server/api/internal/tasks/internal/into_api_task_sort.js";
import {ApiTaskSort} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {taskQuerySortTestCases} from "~/shared/tasks/test_helpers/task_query_sort_test_cases.js";

test("serializes status sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "DisplayStatus", direction: "Ascending"};

    expect(intoApiSort(sort)).toEqual(cast<ApiTaskSort>({type: "Status", direction: "Ascending"}));
});

test("serializes priority sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Priority", direction: "Descending"};

    expect(intoApiSort(sort)).toEqual(
        cast<ApiTaskSort>({type: "Priority", direction: "Descending"}),
    );
});

test("serializes layout sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Layout", missing: "First"};

    expect(intoApiSort(sort)).toEqual(cast<ApiTaskSort>({type: "Layout", missing: "First"}));
});

test("serializes assignee sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Assignee", missing: "Last"};

    expect(intoApiSort(sort)).toEqual(cast<ApiTaskSort>({type: "Assignee", missing: "Last"}));
});

test("serializes creator sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Creator"};

    expect(intoApiSort(sort)).toEqual(cast<ApiTaskSort>({type: "Creator"}));
});

test("serializes assigner sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "Assigner", missing: "First"};

    expect(intoApiSort(sort)).toEqual(cast<ApiTaskSort>({type: "Assigner", missing: "First"}));
});

test("serializes due sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "DueDate", direction: "Ascending"};

    expect(intoApiSort(sort)).toEqual(cast<ApiTaskSort>({type: "Due", direction: "Ascending"}));
});

test("serializes created time sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "CreatedTime", direction: "Descending"};

    expect(intoApiSort(sort)).toEqual(
        cast<ApiTaskSort>({type: "CreatedTime", direction: "Descending"}),
    );
});

test("serializes assigned time sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "AssignedTime", direction: "Ascending"};

    expect(intoApiSort(sort)).toEqual(
        cast<ApiTaskSort>({type: "AssignedTime", direction: "Ascending"}),
    );
});

test("serializes closed time sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "ClosedTime", direction: "Descending"};

    expect(intoApiSort(sort)).toEqual(
        cast<ApiTaskSort>({type: "ClosedTime", direction: "Descending"}),
    );
});

test("serializes activated time sort to the public API shape", () => {
    const sort: TaskQuerySort = {type: "ActivatedTime", direction: "Ascending"};

    expect(intoApiSort(sort)).toEqual(
        cast<ApiTaskSort>({type: "ActivatedTime", direction: "Ascending"}),
    );
});

test.each(taskQuerySortTestCases)("round trip: $name", ({sorts}) => {
    expect(sorts.map(sort => fromApiSort(intoApiSort(sort)))).toEqual(sorts);
});
