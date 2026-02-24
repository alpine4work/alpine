import {CalendarDate} from "@internationalized/date";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryDisplayStatusFilter, TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryAccountNormalizedFilter,
    TaskQueryNormalizedFilters,
    assertNonEmptyReadonlySet,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export function normalizeTaskPersonalViewSorts(
    sorts: ReadonlyArray<TaskQuerySort>,
    numberOfFilters: number,
): ReadonlyArray<TaskQueryNormalizedSort> {
    return numberOfFilters === 0 && sorts.length === 0
        ? [
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
          ]
        : normalizeTaskQuerySorts(sorts);
}

/**
 * Creates an assignee filter for the current user in TaskPersonalView.
 */
export function createTaskPersonalViewAssigneeFilter(
    accountId: AccountId,
): TaskQueryAccountNormalizedFilter {
    return {
        type: "OneOf",
        accountIds: assertNonEmptyReadonlySet(new Set([accountId])),
    };
}

/**
 * Gets the normalized filters for the Active section (OpenActive tasks).
 * Returns null if the user's filters make this section impossible.
 */
export function getPersonalTaskViewActiveSectionQueryFilters({
    userFilters,
    evaluationContext,
    assigneeFilter,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
}): TaskQueryNormalizedFilters | null {
    const sectionFilters: ReadonlyArray<TaskQueryFilter> = [
        createPersonalTaskViewDisplayStatusFilter(new Set(["OpenActive"])),
    ];

    return normalizeWithSectionFilters({
        sectionFilters,
        userFilters,
        evaluationContext,
        assigneeFilter,
    });
}

/**
 * Gets the normalized filters for the Overdue section.
 * Returns null if the user's filters make this section impossible.
 */
export function getPersonalTaskViewOverdueSectionQueryFilters({
    userFilters,
    evaluationContext,
    assigneeFilter,
    displayStatusFilter,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    displayStatusFilter: TaskQueryFilter;
}): TaskQueryNormalizedFilters | null {
    const sectionFilters: ReadonlyArray<TaskQueryFilter> = [
        displayStatusFilter,
        {
            type: "DueDate",
            operation: {
                type: "LessThan",
                date: {type: "RelativeToday"},
            },
        },
    ];

    return normalizeWithSectionFilters({
        sectionFilters,
        userFilters,
        evaluationContext,
        assigneeFilter,
    });
}

/**
 * Gets the normalized filters for the Due Today section.
 * Returns null if the user's filters make this section impossible.
 */
export function getPersonalTaskViewDueTodaySectionQueryFilters({
    userFilters,
    evaluationContext,
    assigneeFilter,
    displayStatusFilter,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    displayStatusFilter: TaskQueryFilter;
}): TaskQueryNormalizedFilters | null {
    // DueToday section: open inactive tasks with due date = today
    // Use GreaterThan (today - 1) AND LessThan (today + 1) to match exactly today
    const sectionFilters: ReadonlyArray<TaskQueryFilter> = [
        displayStatusFilter,
        {
            type: "DueDate",
            operation: {
                type: "GreaterThan",
                date: {type: "RelativeBeforeToday", duration: {type: "Days", count: 1}},
            },
        },
        {
            type: "DueDate",
            operation: {
                type: "LessThan",
                date: {type: "RelativeAfterToday", duration: {type: "Days", count: 1}},
            },
        },
    ];

    return normalizeWithSectionFilters({
        sectionFilters,
        userFilters,
        evaluationContext,
        assigneeFilter,
    });
}

/**
 * Gets the normalized filters for the Due Soon section (next 7 days).
 * Returns null if the user's filters make this section impossible.
 */
export function getPersonalTaskViewDueSoonSectionQueryFilters({
    userFilters,
    evaluationContext,
    assigneeFilter,
    displayStatusFilter,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    displayStatusFilter: TaskQueryFilter;
}): TaskQueryNormalizedFilters | null {
    // DueSoon section: open inactive tasks with due date between today and today + 7 days
    // (exclusive of today, inclusive of next 7 days)
    const sectionFilters: ReadonlyArray<TaskQueryFilter> = [
        displayStatusFilter,
        {
            type: "DueDate",
            operation: {
                type: "GreaterThan",
                date: {type: "RelativeToday"},
            },
        },
        {
            type: "DueDate",
            operation: {
                type: "LessThan",
                date: {type: "RelativeAfterToday", duration: {type: "Days", count: 8}},
            },
        },
    ];

    return normalizeWithSectionFilters({
        sectionFilters,
        userFilters,
        evaluationContext,
        assigneeFilter,
    });
}

/**
 * Gets the normalized filters for the Remaining section.
 * This section shows tasks with due date > today + 7 days OR no due date.
 * Returns null if the user's filters make this section impossible.
 *
 * The Remaining section requires special handling because it shows tasks
 * with "due date > today + 7 days OR no due date". This OR condition
 * (RangeOrIsEmpty) can't be expressed with TaskQueryFilter combinations
 * since multiple date filters are ANDed.
 */
export function getPersonalTaskViewRemainingSectionQueryFilters({
    userFilters,
    evaluationContext,
    assigneeFilter,
    displayStatusFilter,
    currentDate,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
    displayStatusFilter: TaskQueryFilter;
    currentDate: CalendarDate;
}): TaskQueryNormalizedFilters | null {
    // Normalize the display status filter with user filters
    const sectionFilters: ReadonlyArray<TaskQueryFilter> = [displayStatusFilter];

    const baseFilters = normalizeWithSectionFilters({
        sectionFilters,
        userFilters,
        evaluationContext,
        assigneeFilter,
    });

    if (!baseFilters) return null;

    // If user explicitly filters for tasks with no due date, just use that filter directly.
    if (baseFilters.dueDateFilter?.type === "IsEmpty") {
        return baseFilters;
    }

    const remainingLowerBoundDate = currentDate.add({days: 7});

    // If user's date filter ends entirely before the Remaining section's range, skip this
    // section.
    if (
        baseFilters.dueDateFilter?.type === "Range" &&
        baseFilters.dueDateFilter.exclusiveUpperBoundDate !== null &&
        baseFilters.dueDateFilter.exclusiveUpperBoundDate.compare(remainingLowerBoundDate) < 0
    ) {
        return null;
    }

    // Build the RangeOrIsEmpty filter
    const lowerBoundDate =
        baseFilters.dueDateFilter?.type === "Range" &&
        baseFilters.dueDateFilter.exclusiveLowerBoundDate !== null &&
        baseFilters.dueDateFilter.exclusiveLowerBoundDate.compare(remainingLowerBoundDate) > 0
            ? baseFilters.dueDateFilter.exclusiveLowerBoundDate
            : remainingLowerBoundDate;

    const upperBoundDate =
        baseFilters.dueDateFilter?.type === "Range"
            ? baseFilters.dueDateFilter.exclusiveUpperBoundDate
            : null;

    return {
        ...baseFilters,
        dueDateFilter: {
            type: "RangeOrIsEmpty",
            exclusiveLowerBoundDate: lowerBoundDate,
            exclusiveUpperBoundDate: upperBoundDate,
        },
    };
}

/**
 * Gets the normalized filters for the Closed section (Closed tasks).
 * Returns null if the user's filters make this section impossible.
 */
export function getPersonalTaskViewClosedSectionQueryFilters({
    userFilters,
    evaluationContext,
    assigneeFilter,
}: {
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
}): TaskQueryNormalizedFilters | null {
    // We have to normalize the user filters to get the correct display status filter.
    // If the user has not applied closed status filter, we will not show the closed section.
    const normalizedUserFilters = normalizeTaskQueryFilters(userFilters, evaluationContext);

    if (normalizedUserFilters.type === "Impossible") return null;
    if (!normalizedUserFilters.normalizedFilters.displayStatusFilter.ifClosed) return null;

    return normalizeWithSectionFilters({
        sectionFilters: [createPersonalTaskViewDisplayStatusFilter(new Set(["Closed"]))],
        userFilters,
        evaluationContext,
        assigneeFilter,
    });
}

/**
 * Creates a task display status filter for the given statuses.
 */
export function createPersonalTaskViewDisplayStatusFilter(
    displayStatuses: ReadonlySet<TaskDisplayStatus>,
): TaskQueryDisplayStatusFilter {
    return {
        type: "DisplayStatus",
        operation: {type: "OneOf", displayStatuses},
    };
}

/**
 * Helper to normalize section filters combined with user filters.
 * Returns null if the combination is impossible.
 */
function normalizeWithSectionFilters({
    sectionFilters,
    userFilters,
    evaluationContext,
    assigneeFilter,
}: {
    sectionFilters: ReadonlyArray<TaskQueryFilter>;
    userFilters: ReadonlyArray<TaskQueryFilter>;
    evaluationContext: TaskQueryEvaluationContext;
    assigneeFilter: TaskQueryAccountNormalizedFilter;
}): TaskQueryNormalizedFilters | null {
    const result = normalizeTaskQueryFilters(
        [...sectionFilters, ...userFilters],
        evaluationContext,
    );
    if (result.type === "Impossible") return null;
    return {...result.normalizedFilters, assigneeFilter};
}
