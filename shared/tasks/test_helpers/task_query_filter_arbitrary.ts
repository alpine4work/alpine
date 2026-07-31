import {CalendarDate} from "@internationalized/date";
import fc, {Arbitrary, MaybeWeightedArbitrary} from "fast-check";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Id, encodeId, generateId, idByteLength} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {
    TaskQueryCollectionsFilter,
    TaskQueryDisplayStatusFilter,
    TaskQueryDueDateFilter,
    TaskQueryFilter,
    TaskQueryFilterAccountOperation,
    TaskQueryFilterAccountOperationAccount,
    TaskQueryFilterCreatorAccountOperation,
    TaskQueryFilterCreatorAccountOperationAccount,
    TaskQueryFilterDateOperation,
    TaskQueryFilterDateOperationDate,
    TaskQueryFilterDateOperationDuration,
    TaskQueryLayoutFilter,
    TaskQueryPriorityFilter,
    TaskQueryTitleFilterOperation,
} from "~/shared/tasks/task_query_filter.js";

// The binary serialization format stores value list lengths in 6 bits and the
// filter list length in 7 bits, see `serializeTaskQueryFilters()`.
const maxTaskQueryFilterValuesLength = 2 ** 6 - 1;
const maxTaskQueryFiltersLength = 2 ** 7 - 1;

// Use TypeScript `Record` so we get a type error when a type is added to the
// union, reminding us that we need to add another entry. This mirrors
// `createUnionArbitrary()` in `api_content_arbitrary.ts`.
function createUnionArbitrary<Value extends {readonly type: string}>(
    object: Record<Value["type"], MaybeWeightedArbitrary<Value>>,
): Arbitrary<Value> {
    const arbitraries: Array<MaybeWeightedArbitrary<Value>> = Object.values(object);
    return fc.oneof(...arbitraries);
}

function createIdArbitrary<Value extends Id>(reusableIds: ReadonlyArray<Value>): Arbitrary<Value> {
    // Regularly reuse a fixed pool of IDs so the same account or task collection
    // appears across multiple filters in one list.
    return fc.oneof(
        {
            weight: Math.max(1, 10 - reusableIds.length),
            arbitrary: fc
                .uint8Array({minLength: idByteLength, maxLength: idByteLength})
                .map(bytes => encodeId<Value>(bytes)),
        },
        ...reusableIds.map(reusableId => ({weight: 1, arbitrary: fc.constant(reusableId)})),
    );
}

const reusableAccountIds = createArrayWithLength(4, () => generateId<AccountId>());
const reusableTaskCollectionIds = createArrayWithLength(4, () => generateId<TaskCollectionId>());

// Sets may be empty: the task filter editor UI lets you uncheck every value which
// is a filter that matches no tasks. The max length is the complete set of
// statuses.
const TaskDisplayStatusSetArbitrary: Arbitrary<ReadonlySet<TaskDisplayStatus>> = fc
    .uniqueArray(fc.constantFrom<TaskDisplayStatus>("OpenInactive", "OpenActive", "Closed"), {
        maxLength: 3,
    })
    .map(displayStatuses => new Set(displayStatuses));

const TaskQueryDisplayStatusFilterOperationArbitrary = createUnionArbitrary<
    TaskQueryDisplayStatusFilter["operation"]
>({
    OneOf: fc.record({
        type: fc.constant("OneOf"),
        displayStatuses: TaskDisplayStatusSetArbitrary,
    }),
    NoneOf: fc.record({
        type: fc.constant("NoneOf"),
        displayStatuses: TaskDisplayStatusSetArbitrary,
    }),
});

const TaskCollectionIdSetArbitrary: Arbitrary<ReadonlySet<TaskCollectionId>> = fc
    .uniqueArray(createIdArbitrary(reusableTaskCollectionIds), {
        maxLength: maxTaskQueryFilterValuesLength,
    })
    .map(collectionIds => new Set(collectionIds));

const TaskQueryCollectionsFilterOperationArbitrary = createUnionArbitrary<
    TaskQueryCollectionsFilter["operation"]
>({
    IncludesOneOf: fc.record({
        type: fc.constant("IncludesOneOf"),
        collectionIds: TaskCollectionIdSetArbitrary,
    }),
    IncludesAllOf: fc.record({
        type: fc.constant("IncludesAllOf"),
        collectionIds: TaskCollectionIdSetArbitrary,
    }),
    ExcludesAllOf: fc.record({
        type: fc.constant("ExcludesAllOf"),
        collectionIds: TaskCollectionIdSetArbitrary,
    }),
    IsEmpty: fc.record({
        type: fc.constant("IsEmpty"),
    }),
});

// The max length is the complete set of priorities including `null` for no
// priority.
const TaskPrioritySetArbitrary: Arbitrary<ReadonlySet<TaskPriority | null>> = fc
    .uniqueArray(fc.constantFrom<TaskPriority | null>("Low", "Medium", "High", "Urgent", null), {
        maxLength: 5,
    })
    .map(priorities => new Set(priorities));

const TaskQueryPriorityFilterOperationArbitrary = createUnionArbitrary<
    TaskQueryPriorityFilter["operation"]
>({
    OneOf: fc.record({
        type: fc.constant("OneOf"),
        priorities: TaskPrioritySetArbitrary,
    }),
    NoneOf: fc.record({
        type: fc.constant("NoneOf"),
        priorities: TaskPrioritySetArbitrary,
    }),
});

const TaskQueryLayoutFilterOperationArbitrary = createUnionArbitrary<
    TaskQueryLayoutFilter["operation"]
>({
    OneOf: fc.record({
        type: fc.constant("OneOf"),
        layouts: fc.constant(["Project"]),
    }),
    NoneOf: fc.record({
        type: fc.constant("NoneOf"),
        layouts: fc.constant(["Project"]),
    }),
});

const TaskQueryTitleQueryArbitrary = fc.oneof(
    {arbitrary: fc.string({unit: "grapheme-ascii"}), weight: 100},
    {arbitrary: fc.string({unit: "grapheme"}), weight: 10},
    {
        // Constant strings the search param parser treats specially in other positions.
        // They should all round trip as literal title text.
        arbitrary: fc.constantFrom(
            "me",
            "none",
            "break",
            "overdue",
            "today+2w",
            "50% & more #1 + tax",
        ),
        weight: 1,
    },
);

const TaskQueryTitleFilterOperationArbitrary = createUnionArbitrary<TaskQueryTitleFilterOperation>({
    Includes: fc.record({
        type: fc.constant("Includes"),
        titleQuery: TaskQueryTitleQueryArbitrary,
    }),
    Excludes: fc.record({
        type: fc.constant("Excludes"),
        titleQuery: TaskQueryTitleQueryArbitrary,
    }),
});

const TaskQueryFilterAccountOperationAccountArbitrary =
    createUnionArbitrary<TaskQueryFilterAccountOperationAccount>({
        Account: fc.record({
            type: fc.constant("Account"),
            accountId: createIdArbitrary(reusableAccountIds),
        }),
        CurrentAccount: fc.record({
            type: fc.constant("CurrentAccount"),
        }),
        MissingAccount: fc.record({
            type: fc.constant("MissingAccount"),
        }),
    });

const TaskQueryFilterCreatorAccountOperationAccountArbitrary =
    createUnionArbitrary<TaskQueryFilterCreatorAccountOperationAccount>({
        Account: fc.record({
            type: fc.constant("Account"),
            accountId: createIdArbitrary(reusableAccountIds),
        }),
        CurrentAccount: fc.record({
            type: fc.constant("CurrentAccount"),
        }),
    });

// The task filter editor UI can't add the same account to a filter twice so
// account lists are unique. Lists may be empty: an account filter with no accounts
// is a filter that hasn't been fully configured yet.
function createTaskQueryFilterAccountsArbitrary<
    Account extends TaskQueryFilterAccountOperationAccount,
>(accountArbitrary: Arbitrary<Account>): Arbitrary<Array<Account>> {
    return fc.uniqueArray(accountArbitrary, {
        maxLength: maxTaskQueryFilterValuesLength,
        selector: account =>
            account.type === "Account" ? `Account:${account.accountId}` : account.type,
    });
}

const TaskQueryFilterAccountsArbitrary = createTaskQueryFilterAccountsArbitrary(
    TaskQueryFilterAccountOperationAccountArbitrary,
);

const TaskQueryFilterCreatorAccountsArbitrary = createTaskQueryFilterAccountsArbitrary(
    TaskQueryFilterCreatorAccountOperationAccountArbitrary,
);

const TaskQueryFilterAccountOperationArbitrary =
    createUnionArbitrary<TaskQueryFilterAccountOperation>({
        OneOf: fc.record({
            type: fc.constant("OneOf"),
            accounts: TaskQueryFilterAccountsArbitrary,
        }),
        NoneOf: fc.record({
            type: fc.constant("NoneOf"),
            accounts: TaskQueryFilterAccountsArbitrary,
        }),
    });

const TaskQueryFilterCreatorAccountOperationArbitrary =
    createUnionArbitrary<TaskQueryFilterCreatorAccountOperation>({
        OneOf: fc.record({
            type: fc.constant("OneOf"),
            accounts: TaskQueryFilterCreatorAccountsArbitrary,
        }),
        NoneOf: fc.record({
            type: fc.constant("NoneOf"),
            accounts: TaskQueryFilterCreatorAccountsArbitrary,
        }),
    });

// The search param filter format prints dates as 4 digit year ISO 8601 dates so
// years range from 1 to 9999 (`CalendarDate` pads years below 1000 with zeros).
const CalendarDateArbitrary: Arbitrary<CalendarDate> = fc.oneof(
    {
        weight: 20,
        arbitrary: fc
            .record({
                year: fc.integer({min: 1, max: 9999}),
                month: fc.integer({min: 1, max: 12}),
                // Day 29 and up isn't valid in every month so we cover those days with the
                // constants below.
                day: fc.integer({min: 1, max: 28}),
            })
            .map(({year, month, day}) => new CalendarDate(year, month, day)),
    },
    {weight: 1, arbitrary: fc.constant(new CalendarDate(2024, 2, 29))},
    {weight: 1, arbitrary: fc.constant(new CalendarDate(2026, 12, 31))},
);

// Durations serialize as unsigned 32-bit integers, see
// `serializeTaskQueryFilterDateOperationDuration()`. `fc.integer()` only supports
// signed 32-bit integers so we cover the upper half of the range with the maximum
// value as a constant.
const TaskQueryFilterDateOperationDurationCountArbitrary = fc.oneof(
    {weight: 20, arbitrary: fc.integer({min: 0})},
    {weight: 1, arbitrary: fc.constant(2 ** 32 - 1)},
);

const TaskQueryFilterDateOperationDurationArbitrary =
    createUnionArbitrary<TaskQueryFilterDateOperationDuration>({
        Days: fc.record({
            type: fc.constant("Days"),
            count: TaskQueryFilterDateOperationDurationCountArbitrary,
        }),
        Weeks: fc.record({
            type: fc.constant("Weeks"),
            count: TaskQueryFilterDateOperationDurationCountArbitrary,
        }),
        Months: fc.record({
            type: fc.constant("Months"),
            count: TaskQueryFilterDateOperationDurationCountArbitrary,
        }),
        Years: fc.record({
            type: fc.constant("Years"),
            count: TaskQueryFilterDateOperationDurationCountArbitrary,
        }),
    });

const TaskQueryFilterDateOperationDateArbitrary =
    createUnionArbitrary<TaskQueryFilterDateOperationDate>({
        Absolute: fc.record({
            type: fc.constant("Absolute"),
            date: fc.oneof(
                {weight: 5, arbitrary: CalendarDateArbitrary},
                // A `null` date is a filter whose date hasn't been chosen yet in the task filter
                // editor UI.
                {weight: 1, arbitrary: fc.constant(null)},
            ),
        }),
        RelativeToday: fc.record({
            type: fc.constant("RelativeToday"),
        }),
        RelativeAfterToday: fc.record({
            type: fc.constant("RelativeAfterToday"),
            duration: TaskQueryFilterDateOperationDurationArbitrary,
        }),
        RelativeBeforeToday: fc.record({
            type: fc.constant("RelativeBeforeToday"),
            duration: TaskQueryFilterDateOperationDurationArbitrary,
        }),
    });

const TaskQueryFilterLessThanDateOperationArbitrary = fc.record({
    type: fc.constant("LessThan"),
    date: TaskQueryFilterDateOperationDateArbitrary,
});

const TaskQueryFilterGreaterThanDateOperationArbitrary = fc.record({
    type: fc.constant("GreaterThan"),
    date: TaskQueryFilterDateOperationDateArbitrary,
});

const TaskQueryFilterDateOperationArbitrary = createUnionArbitrary<TaskQueryFilterDateOperation>({
    LessThan: TaskQueryFilterLessThanDateOperationArbitrary,
    GreaterThan: TaskQueryFilterGreaterThanDateOperationArbitrary,
});

const TaskQueryDueDateFilterOperationArbitrary = createUnionArbitrary<
    TaskQueryDueDateFilter["operation"]
>({
    Overdue: fc.record({
        type: fc.constant("Overdue"),
    }),
    IsEmpty: fc.record({
        type: fc.constant("IsEmpty"),
    }),
    LessThan: TaskQueryFilterLessThanDateOperationArbitrary,
    GreaterThan: TaskQueryFilterGreaterThanDateOperationArbitrary,
});

/**
 * An arbitrary that covers every possible `TaskQueryFilter`. If a filter is
 * representable by the `TaskQueryFilter` data structure then this arbitrary
 * generates it.
 */
export const TaskQueryFilterArbitrary: Arbitrary<TaskQueryFilter> =
    createUnionArbitrary<TaskQueryFilter>({
        DisplayStatus: fc.record({
            type: fc.constant("DisplayStatus"),
            operation: TaskQueryDisplayStatusFilterOperationArbitrary,
        }),
        Collections: fc.record({
            type: fc.constant("Collections"),
            operation: TaskQueryCollectionsFilterOperationArbitrary,
        }),
        Priority: fc.record({
            type: fc.constant("Priority"),
            operation: TaskQueryPriorityFilterOperationArbitrary,
        }),
        Layout: fc.record({
            type: fc.constant("Layout"),
            operation: TaskQueryLayoutFilterOperationArbitrary,
        }),
        Title: fc.record({
            type: fc.constant("Title"),
            operation: TaskQueryTitleFilterOperationArbitrary,
        }),
        Assignee: fc.record({
            type: fc.constant("Assignee"),
            operation: TaskQueryFilterAccountOperationArbitrary,
        }),
        Creator: fc.record({
            type: fc.constant("Creator"),
            operation: TaskQueryFilterCreatorAccountOperationArbitrary,
        }),
        Assigner: fc.record({
            type: fc.constant("Assigner"),
            operation: TaskQueryFilterAccountOperationArbitrary,
        }),
        DueDate: fc.record({
            type: fc.constant("DueDate"),
            operation: TaskQueryDueDateFilterOperationArbitrary,
        }),
        CreatedDate: fc.record({
            type: fc.constant("CreatedDate"),
            operation: TaskQueryFilterDateOperationArbitrary,
        }),
        AssignedDate: fc.record({
            type: fc.constant("AssignedDate"),
            operation: TaskQueryFilterDateOperationArbitrary,
        }),
        ClosedDate: fc.record({
            type: fc.constant("ClosedDate"),
            operation: TaskQueryFilterDateOperationArbitrary,
        }),
        ActivatedDate: fc.record({
            type: fc.constant("ActivatedDate"),
            operation: TaskQueryFilterDateOperationArbitrary,
        }),
    });

/**
 * An arbitrary for a list of task query filters like the ones stored in task
 * views.
 */
export const TaskQueryFiltersArbitrary: Arbitrary<ReadonlyArray<TaskQueryFilter>> = fc.array(
    TaskQueryFilterArbitrary,
    {maxLength: maxTaskQueryFiltersLength},
);
