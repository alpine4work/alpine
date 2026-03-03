import {today} from "@internationalized/date";
import {
    createPersonalTaskViewDisplayStatusFilter,
    createTaskPersonalViewAssigneeFilter,
    getPersonalTaskViewActiveSectionQueryFilters,
    getPersonalTaskViewClosedSectionQueryFilters,
    getPersonalTaskViewDueSoonSectionQueryFilters,
    getPersonalTaskViewDueTodaySectionQueryFilters,
    getPersonalTaskViewOverdueSectionQueryFilters,
    getPersonalTaskViewRemainingSectionQueryFilters,
    normalizeTaskPersonalViewSorts,
} from "~/client/web/tasks/get_task_personal_view_section_filters.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryAccountNormalizedFilter,
    assertNonEmptyReadonlySet,
} from "~/shared/tasks/task_query_normalized_filters.js";

const TEST_ACCOUNT_ID = generateId<AccountId>();
const TEST_CURRENT_DATE = today(defaultTimeZone);

const defaultEvaluationContext: TaskQueryEvaluationContext = {
    currentAccountId: TEST_ACCOUNT_ID,
    currentDate: TEST_CURRENT_DATE,
};

const defaultAssigneeFilter: TaskQueryAccountNormalizedFilter = {
    type: "OneOf",
    accountIds: assertNonEmptyReadonlySet(new Set([TEST_ACCOUNT_ID])),
};

const openInactiveDisplayStatusFilter = createPersonalTaskViewDisplayStatusFilter(
    new Set(["OpenInactive"]),
);

describe("normalizeTaskPersonalViewSorts", () => {
    test("returns default sorts when no filters and no sorts", () => {
        const result = normalizeTaskPersonalViewSorts([], 0);

        expect(result).toEqual([
            {
                type: "AssigneePosition",
                direction: "Descending",
                missing: "Last",
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ]);
    });

    test("returns normalized sorts when filters are present", () => {
        const result = normalizeTaskPersonalViewSorts([], 1);

        // When filters are present but no sorts, falls back to default CreatedTime sort
        expect(result).toEqual([
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ]);
    });

    test("returns normalized sorts when sorts are provided", () => {
        const result = normalizeTaskPersonalViewSorts(
            [{type: "DueDate", direction: "Ascending"}],
            0,
        );

        // Normalized sorts include the requested sort plus a tiebreaker
        expect(result).toEqual([
            {
                type: "DueDate",
                direction: "Ascending",
                missing: "Last",
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ]);
    });
});

describe("createTaskPersonalViewAssigneeFilter", () => {
    test("creates filter with OneOf operation and account ID", () => {
        const accountId = generateId<AccountId>();
        const result = createTaskPersonalViewAssigneeFilter(accountId);

        expect(result).toEqual({
            type: "OneOf",
            accountIds: assertNonEmptyReadonlySet(new Set([accountId])),
        });
    });
});

describe("createPersonalTaskViewDisplayStatusFilter", () => {
    test("creates filter with single status", () => {
        const result = createPersonalTaskViewDisplayStatusFilter(new Set(["OpenActive"]));

        expect(result).toEqual({
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenActive"]),
            },
        });
    });

    test("creates filter with multiple statuses", () => {
        const result = createPersonalTaskViewDisplayStatusFilter(
            new Set(["OpenActive", "OpenInactive"]),
        );

        expect(result).toEqual({
            type: "DisplayStatus",
            operation: {
                type: "OneOf",
                displayStatuses: new Set(["OpenActive", "OpenInactive"]),
            },
        });
    });
});

describe("getPersonalTaskViewActiveSectionQueryFilters", () => {
    const callWithDefaults = (userFilters: ReadonlyArray<TaskQueryFilter> = []) =>
        getPersonalTaskViewActiveSectionQueryFilters({
            userFilters,
            evaluationContext: defaultEvaluationContext,
            assigneeFilter: defaultAssigneeFilter,
        });

    test("returns filters with OpenActive status when no user filters", () => {
        const result = callWithDefaults();

        expect(result).not.toBeNull();
        expect(result?.displayStatusFilter).toEqual({
            ifOpenActive: true,
            ifOpenInactive: false,
            ifClosed: false,
        });
    });

    test("includes assignee filter in result", () => {
        const result = callWithDefaults();

        expect(result?.assigneeFilter).toEqual(defaultAssigneeFilter);
    });

    test("returns null when user filters for Closed only", () => {
        const result = callWithDefaults([
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
            },
        ]);

        expect(result).toBeNull();
    });

    test("returns null when user filters for OpenInactive only", () => {
        const result = callWithDefaults([
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive"])},
            },
        ]);

        expect(result).toBeNull();
    });

    test("merges user priority filter with section filters", () => {
        const result = callWithDefaults([
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["High", "Urgent"])},
            },
        ]);

        expect(result).not.toBeNull();
        expect(result?.priorityFilter).toEqual({
            ifHigh: true,
            ifUrgent: true,
            ifMedium: false,
            ifLow: false,
            ifNull: false,
        });
    });
});

describe("getPersonalTaskViewOverdueSectionQueryFilters", () => {
    const callWithDefaults = (userFilters: ReadonlyArray<TaskQueryFilter> = []) =>
        getPersonalTaskViewOverdueSectionQueryFilters({
            userFilters,
            evaluationContext: defaultEvaluationContext,
            assigneeFilter: defaultAssigneeFilter,
            displayStatusFilter: openInactiveDisplayStatusFilter,
        });

    test("returns filters with due date before today when no user filters", () => {
        const result = callWithDefaults();

        expect(result).not.toBeNull();
        expect(result?.dueDateFilter).toEqual({
            type: "Range",
            exclusiveLowerBoundDate: null,
            exclusiveUpperBoundDate: TEST_CURRENT_DATE,
        });
    });

    test("returns filters with OpenInactive status", () => {
        const result = callWithDefaults();

        expect(result?.displayStatusFilter).toEqual({
            ifOpenActive: false,
            ifOpenInactive: true,
            ifClosed: false,
        });
    });

    test("returns null when user filters for future due date only", () => {
        const result = callWithDefaults([
            {
                type: "DueDate",
                operation: {
                    type: "GreaterThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 10}},
                },
            },
        ]);

        expect(result).toBeNull();
    });

    test("includes assignee filter in result", () => {
        const result = callWithDefaults();

        expect(result?.assigneeFilter).toEqual(defaultAssigneeFilter);
    });
});

describe("getPersonalTaskViewDueTodaySectionQueryFilters", () => {
    const callWithDefaults = (userFilters: ReadonlyArray<TaskQueryFilter> = []) =>
        getPersonalTaskViewDueTodaySectionQueryFilters({
            userFilters,
            evaluationContext: defaultEvaluationContext,
            assigneeFilter: defaultAssigneeFilter,
            displayStatusFilter: openInactiveDisplayStatusFilter,
        });

    test("returns filters with due date equal to today when no user filters", () => {
        const result = callWithDefaults();

        expect(result).not.toBeNull();
        // Due date filter should be: yesterday < dueDate < tomorrow (i.e., exactly today)
        expect(result?.dueDateFilter).toEqual({
            type: "Range",
            exclusiveLowerBoundDate: TEST_CURRENT_DATE.subtract({days: 1}),
            exclusiveUpperBoundDate: TEST_CURRENT_DATE.add({days: 1}),
        });
    });

    test("returns filters with OpenInactive status", () => {
        const result = callWithDefaults();

        expect(result?.displayStatusFilter).toEqual({
            ifOpenActive: false,
            ifOpenInactive: true,
            ifClosed: false,
        });
    });

    test("returns null when user filters for past due date only", () => {
        const result = callWithDefaults([
            {
                type: "DueDate",
                operation: {
                    type: "LessThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 5}},
                },
            },
        ]);

        expect(result).toBeNull();
    });

    test("returns null when user filters for future due date only", () => {
        const result = callWithDefaults([
            {
                type: "DueDate",
                operation: {
                    type: "GreaterThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 5}},
                },
            },
        ]);

        expect(result).toBeNull();
    });
});

describe("getPersonalTaskViewDueSoonSectionQueryFilters", () => {
    const callWithDefaults = (userFilters: ReadonlyArray<TaskQueryFilter> = []) =>
        getPersonalTaskViewDueSoonSectionQueryFilters({
            userFilters,
            evaluationContext: defaultEvaluationContext,
            assigneeFilter: defaultAssigneeFilter,
            displayStatusFilter: openInactiveDisplayStatusFilter,
        });

    test("returns filters with due date in next 7 days when no user filters", () => {
        const result = callWithDefaults();

        expect(result).not.toBeNull();
        // Due date filter should be: today < dueDate < today + 8 days
        expect(result?.dueDateFilter).toEqual({
            type: "Range",
            exclusiveLowerBoundDate: TEST_CURRENT_DATE,
            exclusiveUpperBoundDate: TEST_CURRENT_DATE.add({days: 8}),
        });
    });

    test("returns filters with OpenInactive status", () => {
        const result = callWithDefaults();

        expect(result?.displayStatusFilter).toEqual({
            ifOpenActive: false,
            ifOpenInactive: true,
            ifClosed: false,
        });
    });

    test("returns null when user filters for past due date only", () => {
        const result = callWithDefaults([
            {
                type: "DueDate",
                operation: {
                    type: "LessThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 5}},
                },
            },
        ]);

        expect(result).toBeNull();
    });

    test("returns null when user filters for far future due date only", () => {
        const result = callWithDefaults([
            {
                type: "DueDate",
                operation: {
                    type: "GreaterThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 30}},
                },
            },
        ]);

        expect(result).toBeNull();
    });
});

describe("getPersonalTaskViewRemainingSectionQueryFilters", () => {
    const callWithDefaults = (userFilters: ReadonlyArray<TaskQueryFilter> = []) =>
        getPersonalTaskViewRemainingSectionQueryFilters({
            userFilters,
            evaluationContext: defaultEvaluationContext,
            assigneeFilter: defaultAssigneeFilter,
            displayStatusFilter: openInactiveDisplayStatusFilter,
            currentDate: TEST_CURRENT_DATE,
        });

    test("returns RangeOrIsEmpty filter with lower bound 7 days from today", () => {
        const result = callWithDefaults();

        expect(result).not.toBeNull();
        expect(result?.dueDateFilter).toEqual({
            type: "RangeOrIsEmpty",
            exclusiveLowerBoundDate: TEST_CURRENT_DATE.add({days: 7}),
            exclusiveUpperBoundDate: null,
        });
    });

    test("returns filters with OpenInactive status", () => {
        const result = callWithDefaults();

        expect(result?.displayStatusFilter).toEqual({
            ifOpenActive: false,
            ifOpenInactive: true,
            ifClosed: false,
        });
    });

    test("returns IsEmpty filter when user filters for no due date", () => {
        const result = callWithDefaults([
            {
                type: "DueDate",
                operation: {type: "IsEmpty"},
            },
        ]);

        expect(result).not.toBeNull();
        expect(result?.dueDateFilter).toEqual({
            type: "IsEmpty",
        });
    });

    test("returns null when user filters for due date entirely before remaining range", () => {
        // User filters for due date < today + 3 days (before the remaining section's
        // range)
        const result = callWithDefaults([
            {
                type: "DueDate",
                operation: {
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 3}},
                },
            },
        ]);

        expect(result).toBeNull();
    });

    test("respects user upper bound filter", () => {
        const result = callWithDefaults([
            {
                type: "DueDate",
                operation: {
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 30}},
                },
            },
        ]);

        expect(result).not.toBeNull();
        expect(result?.dueDateFilter).toEqual({
            type: "RangeOrIsEmpty",
            exclusiveLowerBoundDate: TEST_CURRENT_DATE.add({days: 7}),
            exclusiveUpperBoundDate: TEST_CURRENT_DATE.add({days: 30}),
        });
    });

    test("uses user lower bound when greater than section lower bound", () => {
        const result = callWithDefaults([
            {
                type: "DueDate",
                operation: {
                    type: "GreaterThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", count: 14}},
                },
            },
        ]);

        expect(result).not.toBeNull();
        expect(result?.dueDateFilter).toEqual({
            type: "RangeOrIsEmpty",
            exclusiveLowerBoundDate: TEST_CURRENT_DATE.add({days: 14}),
            exclusiveUpperBoundDate: null,
        });
    });
});

describe("getPersonalTaskViewClosedSectionQueryFilters", () => {
    const callWithDefaults = (userFilters: ReadonlyArray<TaskQueryFilter> = []) =>
        getPersonalTaskViewClosedSectionQueryFilters({
            userFilters,
            evaluationContext: defaultEvaluationContext,
            assigneeFilter: defaultAssigneeFilter,
        });

    test("returns null when no user filters (closed section only shown when user explicitly filters for Closed)", () => {
        const result = callWithDefaults();

        // By default (no filters), the normalized display status filter doesn't include
        // Closed, so the Closed section should not be shown
        expect(result).toBeNull();
    });

    test("returns null when user filters for OpenActive only", () => {
        const result = callWithDefaults([
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
            },
        ]);

        expect(result).toBeNull();
    });

    test("returns null when user filters for OpenInactive only", () => {
        const result = callWithDefaults([
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive"])},
            },
        ]);

        expect(result).toBeNull();
    });

    test("returns filters when user explicitly filters for Closed", () => {
        const result = callWithDefaults([
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
            },
        ]);

        expect(result).not.toBeNull();
        expect(result?.displayStatusFilter).toEqual({
            ifOpenActive: false,
            ifOpenInactive: false,
            ifClosed: true,
        });
    });

    test("returns filters when user filters for Closed among other statuses", () => {
        const result = callWithDefaults([
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenActive", "Closed"])},
            },
        ]);

        expect(result).not.toBeNull();
        expect(result?.displayStatusFilter).toEqual({
            ifOpenActive: false,
            ifOpenInactive: false,
            ifClosed: true,
        });
    });

    test("includes assignee filter in result when user filters for Closed", () => {
        const result = callWithDefaults([
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
            },
        ]);

        expect(result?.assigneeFilter).toEqual(defaultAssigneeFilter);
    });

    test("merges user priority filter with section filters when filtering for Closed", () => {
        const result = callWithDefaults([
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
            },
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["High"])},
            },
        ]);

        expect(result).not.toBeNull();
        expect(result?.priorityFilter).toEqual({
            ifHigh: true,
            ifUrgent: false,
            ifMedium: false,
            ifLow: false,
            ifNull: false,
        });
    });

    test("no due date filter constraints when filtering for Closed", () => {
        const result = callWithDefaults([
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
            },
        ]);

        // Closed section should not have any due date constraints
        expect(result?.dueDateFilter).toBeUndefined();
    });
});
