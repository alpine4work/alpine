import {CalendarDate} from "@internationalized/date";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {getTaskQueryNormalizedFiltersInitialFields} from "~/shared/tasks/task_query_normalized_filters_initial_fields.js";

// NOTE(calebmer, 2025-03-19): The tests in this file were written by AI.

function createNormalizedFilters(
    filters: Array<TaskQueryFilter>,
    evaluationContext: TaskQueryEvaluationContext,
) {
    const result = normalizeTaskQueryFilters(filters, evaluationContext);
    assert(result.type !== "Impossible");
    return result.normalizedFilters;
}

test("returns default values when no filters are specified", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [];
    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);

    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

// Display Status Filter Tests
test("sets status and assigneeStatus for ifOpenInactive", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenInactive"]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets status, assigneeStatus, and assigneeId for ifOpenActive with currentAccountId", () => {
    const currentAccountId = generateId<AccountId>();
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenActive"]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: currentAccountId,
        assigneeStatus: "Active",
        dueDate: null,
    });
});

test("doesn\u2019t set assigneeId for ifOpenActive without currentAccountId", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenActive"]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets status to Closed for ifClosed", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["Closed"]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Closed",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

// Collections Filter Tests
test("sets collectionIds from IncludesAllOf collectionsFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const collectionId1 = generateId<TaskCollectionId>();
    const collectionId2 = generateId<TaskCollectionId>();

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Collections",
            operation: {
                type: "IncludesAllOf",
                collectionIds: new Set([collectionId1, collectionId2]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set([collectionId1, collectionId2]),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets collectionIds from IncludesOneOf collectionsFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const collectionId1 = generateId<TaskCollectionId>();
    const collectionId2 = generateId<TaskCollectionId>();

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Collections",
            operation: {
                type: "IncludesOneOf",
                collectionIds: new Set([collectionId1, collectionId2]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set([collectionId1]),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("ignores negated terms in collectionsFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const collectionId = generateId<TaskCollectionId>();

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Collections",
            operation: {
                type: "ExcludesAllOf",
                collectionIds: new Set([collectionId]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("ignores IsEmpty term in collectionsFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Collections",
            operation: {
                type: "IsEmpty",
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

// Priority Filter Tests
test("sets priority to null from priorityFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Priority",
            operation: {
                type: "OneOf",
                priorities: new Set([null]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets priority to Low from priorityFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Priority",
            operation: {
                type: "OneOf",
                priorities: new Set(["Low"]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: "Low",
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets priority to Medium from priorityFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Priority",
            operation: {
                type: "OneOf",
                priorities: new Set(["Medium"]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: "Medium",
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets priority to High from priorityFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Priority",
            operation: {
                type: "OneOf",
                priorities: new Set(["High"]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: "High",
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets priority to Urgent from priorityFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Priority",
            operation: {
                type: "OneOf",
                priorities: new Set(["Urgent"]),
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: "Urgent",
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

// Title Filter Tests
test("sets title from titleFilter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Title",
            operation: {
                type: "Includes",
                titleQuery: "Task Title",
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "Task Title",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("combines multiple titleFilter entries with spaces", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Title",
            operation: {
                type: "Includes",
                titleQuery: "First",
            },
        },
        {
            type: "Title",
            operation: {
                type: "Includes",
                titleQuery: "Second",
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "First Second",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

// Assignee Filter Tests
test("keeps assigneeId if it already matches OneOf filter", () => {
    const assigneeId = generateId<AccountId>();
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: assigneeId,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    // First set the assignee ID using an OpenActive filter
    const filters: Array<TaskQueryFilter> = [
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenActive"]),
            },
        },
        {
            type: "Assignee",
            operation: {
                type: "OneOf",
                accounts: [{type: "Account", accountId: assigneeId}],
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: assigneeId,
        assigneeStatus: "Active",
        dueDate: null,
    });
});

test("sets assigneeId from OneOf filter when it doesn\u2019t match", () => {
    const assigneeId = generateId<AccountId>();
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Assignee",
            operation: {
                type: "OneOf",
                accounts: [{type: "Account", accountId: assigneeId}],
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: assigneeId,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets assigneeId to null when OneOf filter only contains MissingAccount", () => {
    const currentAccountId = generateId<AccountId>();
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenActive"]),
            },
        },
        {
            type: "Assignee",
            operation: {
                type: "OneOf",
                accounts: [{type: "MissingAccount"}],
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("keeps assigneeId if it already matches NoneOf filter", () => {
    const assigneeId1 = generateId<AccountId>();
    const assigneeId2 = generateId<AccountId>();
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: assigneeId1,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    // First set the assignee ID using an OpenActive filter
    const filters: Array<TaskQueryFilter> = [
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenActive"]),
            },
        },
        {
            type: "Assignee",
            operation: {
                type: "NoneOf",
                accounts: [{type: "Account", accountId: assigneeId2}],
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: assigneeId1,
        assigneeStatus: "Active",
        dueDate: null,
    });
});

test("sets assigneeId to currentAccountId with NoneOf filter when available", () => {
    const assigneeId = generateId<AccountId>();
    const currentAccountId = generateId<AccountId>();
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Assignee",
            operation: {
                type: "NoneOf",
                accounts: [{type: "Account", accountId: assigneeId}],
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets assigneeId to null with NoneOf filter when MissingAccount is not in filter", () => {
    const assigneeId = generateId<AccountId>();
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: assigneeId, // Current account is in the filter
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenActive"]),
            },
        },
        {
            type: "Assignee",
            operation: {
                type: "NoneOf",
                accounts: [{type: "Account", accountId: assigneeId}],
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets assigneeId to currentAccountId with NoneOf filter when MissingAccount is in filter", () => {
    const currentAccountId = generateId<AccountId>();
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Assignee",
            operation: {
                type: "NoneOf",
                accounts: [{type: "MissingAccount"}],
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: currentAccountId,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets assigneeId to null with NoneOf filter when MissingAccount and currentAccountId is in filter", () => {
    const currentAccountId = generateId<AccountId>();
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "Assignee",
            operation: {
                type: "NoneOf",
                accounts: [
                    {type: "MissingAccount"},
                    {type: "Account", accountId: currentAccountId},
                ],
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

// Due Date Filter Tests
test("leaves dueDate null for IsEmpty filter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DueDate",
            operation: {
                type: "IsEmpty",
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("leaves dueDate null for RangeOrIsEmpty filter", () => {
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate: new CalendarDate(2023, 1, 1),
    };

    // Create a filter that will be converted to RangeOrIsEmpty in the normalized form
    const filters: Array<TaskQueryFilter> = [
        {
            type: "DueDate",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "Absolute",
                    date: new CalendarDate(2023, 1, 10),
                },
            },
        },
    ];

    const normalizedFilters: TaskQueryNormalizedFilters = {
        ...createNormalizedFilters(filters, evaluationContext),
        // Force the type to RangeOrIsEmpty for testing purposes
        dueDateFilter: {
            type: "RangeOrIsEmpty",
            exclusiveLowerBoundDate: new CalendarDate(2023, 1, 10),
            exclusiveUpperBoundDate: null,
        },
    };

    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: null,
    });
});

test("sets dueDate to a week from today when it falls within the range", () => {
    const currentDate = new CalendarDate(2023, 1, 1);
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate,
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DueDate",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "Absolute",
                    date: new CalendarDate(2022, 12, 25),
                },
            },
        },
        {
            type: "DueDate",
            operation: {
                type: "LessThan",
                date: {
                    type: "Absolute",
                    date: new CalendarDate(2023, 1, 15),
                },
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    const expectedDate = currentDate.add({days: 7});

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: expectedDate,
    });
});

test("sets dueDate to lower bound + 1 day when a week from today is before the range", () => {
    const currentDate = new CalendarDate(2023, 1, 1);
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate,
    };

    const lowerBoundDate = new CalendarDate(2023, 1, 10);

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DueDate",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "Absolute",
                    date: lowerBoundDate,
                },
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    const expectedDate = lowerBoundDate.add({days: 1});

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: expectedDate,
    });
});

test("sets dueDate to upper bound - 1 day when a week from today is after the range", () => {
    const currentDate = new CalendarDate(2023, 1, 1);
    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: null,
        currentDate,
    };

    const upperBoundDate = new CalendarDate(2023, 1, 5);

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DueDate",
            operation: {
                type: "LessThan",
                date: {
                    type: "Absolute",
                    date: upperBoundDate,
                },
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    const expectedDate = upperBoundDate.subtract({days: 1});

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set(),
        priority: null,
        title: "",
        assigneeId: null,
        assigneeStatus: "Inactive",
        dueDate: expectedDate,
    });
});

test("combines multiple filter types correctly", () => {
    const assigneeId = generateId<AccountId>();
    const collectionId = generateId<TaskCollectionId>();
    const currentDate = new CalendarDate(2023, 1, 1);

    const evaluationContext: TaskQueryEvaluationContext = {
        currentAccountId: assigneeId,
        currentDate,
    };

    const filters: Array<TaskQueryFilter> = [
        {
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenActive"]),
            },
        },
        {
            type: "Collections",
            operation: {
                type: "IncludesOneOf",
                collectionIds: new Set([collectionId]),
            },
        },
        {
            type: "Priority",
            operation: {
                type: "OneOf",
                priorities: new Set(["High"]),
            },
        },
        {
            type: "Title",
            operation: {
                type: "Includes",
                titleQuery: "Important Task",
            },
        },
        {
            type: "DueDate",
            operation: {
                type: "LessThan",
                date: {
                    type: "Absolute",
                    date: new CalendarDate(2023, 1, 15),
                },
            },
        },
    ];

    const normalizedFilters = createNormalizedFilters(filters, evaluationContext);
    const result = getTaskQueryNormalizedFiltersInitialFields(normalizedFilters, evaluationContext);

    const expectedDueDate = currentDate.add({days: 7});

    expect(result).toEqual({
        status: "Open",
        collectionIds: new Set([collectionId]),
        priority: "High",
        title: "Important Task",
        assigneeId: assigneeId,
        assigneeStatus: "Active",
        dueDate: expectedDueDate,
    });
});
