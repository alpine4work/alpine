import {
    fromApiFilter,
    intoApiFilter,
} from "~/shared/api/content/closed_source/into_api_task_filter.js";
import {ApiTaskFilter} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {taskQueryFilterTestCases} from "~/shared/tasks/test_helpers/task_query_filter_test_cases.js";

test("serializes status filter to the public API shape", () => {
    const filter: TaskQueryFilter = {
        type: "DisplayStatus",
        operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive", "Closed"])},
    };

    expect(intoApiFilter(filter)).toEqual(
        cast<ApiTaskFilter>({
            type: "Status",
            operation: {
                type: "OneOf",
                statuses: [{type: "Open", isActive: false}, {type: "Closed"}],
            },
        }),
    );
});

test("serializes collections filter to the public API shape", () => {
    const collectionId = generateId<TaskCollectionId>();
    const filter: TaskQueryFilter = {
        type: "Collections",
        operation: {type: "IncludesOneOf", collectionIds: new Set([collectionId])},
    };

    expect(intoApiFilter(filter)).toEqual(
        cast<ApiTaskFilter>({
            type: "Collections",
            operation: {type: "IncludesOneOf", collections: [{id: collectionId}]},
        }),
    );
});

test("serializes priority filter to the public API shape", () => {
    const filter: TaskQueryFilter = {
        type: "Priority",
        operation: {type: "NoneOf", priorities: new Set(["High", null])},
    };

    expect(intoApiFilter(filter)).toEqual(
        cast<ApiTaskFilter>({
            type: "Priority",
            operation: {type: "NoneOf", priorities: [{type: "High"}, null]},
        }),
    );
});

test("serializes layout filter to the public API shape", () => {
    const filter: TaskQueryFilter = {
        type: "Layout",
        operation: {type: "OneOf", layouts: ["Project"]},
    };

    expect(intoApiFilter(filter)).toEqual(
        cast<ApiTaskFilter>({
            type: "Layout",
            operation: {type: "OneOf", layouts: [{type: "Project"}]},
        }),
    );
});

test("serializes due filter to the public API shape", () => {
    const filter: TaskQueryFilter = {
        type: "DueDate",
        operation: {
            type: "GreaterThan",
            date: {
                type: "RelativeAfterToday",
                duration: {type: "Months", count: 3},
            },
        },
    };

    expect(intoApiFilter(filter)).toEqual(
        cast<ApiTaskFilter>({
            type: "Due",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "RelativeAfterToday",
                    duration: {type: "Months", months: 3},
                },
            },
        }),
    );
});

test("normalizes repeated status filter API values", () => {
    const filter: ApiTaskFilter = {
        type: "Status",
        operation: {
            type: "OneOf",
            statuses: [
                {type: "Open", isActive: false},
                {type: "Open", isActive: false},
                {type: "Closed"},
            ],
        },
    };

    expect(fromApiFilter(filter)).toEqual({
        type: "DisplayStatus",
        operation: {
            type: "OneOf",
            displayStatuses: new Set(["OpenInactive", "Closed"]),
        },
    });
});

test("normalizes repeated layout filter API values", () => {
    const filter: ApiTaskFilter = {
        type: "Layout",
        operation: {
            type: "OneOf",
            layouts: [{type: "Project"}, {type: "Project"}],
        },
    };

    expect(fromApiFilter(filter)).toEqual({
        type: "Layout",
        operation: {
            type: "OneOf",
            layouts: ["Project"],
        },
    });
});

test.each(taskQueryFilterTestCases)("round trip: $name", ({filters}) => {
    expect(filters.map(filter => fromApiFilter(intoApiFilter(filter)))).toEqual(filters);
});
