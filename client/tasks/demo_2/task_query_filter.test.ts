import {CalendarDate, GregorianCalendar} from "@internationalized/date";
import {
    TaskQueryFilter,
    TaskQueryFilterAccountOperation,
    TaskQueryFilterDateOperation,
    deserializeTaskQueryFilters,
    serializeTaskQueryFilters,
} from "~/client/tasks/demo_2/task_query_filter";
import {cast} from "~/shared/helpers/control/cast";
import {generateId} from "~/shared/id/id";

const testCases: Array<{name: string; filters: Array<TaskQueryFilter>}> = [
    {
        name: "empty",
        filters: [],
    },
    {
        name: "open status",
        filters: [
            {type: "Status", operation: {type: "OneOf", statuses: new Set(["OpenInactive"])}},
        ],
    },
    {
        name: "not open status",
        filters: [
            {type: "Status", operation: {type: "NoneOf", statuses: new Set(["OpenInactive"])}},
        ],
    },
    {
        name: "active status",
        filters: [{type: "Status", operation: {type: "OneOf", statuses: new Set(["OpenActive"])}}],
    },
    {
        name: "not active status",
        filters: [{type: "Status", operation: {type: "NoneOf", statuses: new Set(["OpenActive"])}}],
    },
    {
        name: "closed status",
        filters: [{type: "Status", operation: {type: "OneOf", statuses: new Set(["Closed"])}}],
    },
    {
        name: "not closed status",
        filters: [{type: "Status", operation: {type: "NoneOf", statuses: new Set(["Closed"])}}],
    },
    {
        name: "open and active status",
        filters: [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenInactive", "OpenActive"])},
            },
        ],
    },
    {
        name: "not open and active status",
        filters: [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenInactive", "OpenActive"])},
            },
        ],
    },
    {
        name: "open and active status in different order",
        filters: [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenActive", "OpenInactive"])},
            },
        ],
    },
    {
        name: "not open and active status in different order",
        filters: [
            {
                type: "Status",
                operation: {type: "NoneOf", statuses: new Set(["OpenActive", "OpenInactive"])},
            },
        ],
    },
    {
        name: "multiple status filters",
        filters: [
            {type: "Status", operation: {type: "OneOf", statuses: new Set(["OpenInactive"])}},
            {type: "Status", operation: {type: "NoneOf", statuses: new Set(["Closed"])}},
            {type: "Status", operation: {type: "OneOf", statuses: new Set(["OpenInactive"])}},
            {
                type: "Status",
                operation: {type: "OneOf", statuses: new Set(["OpenInactive", "OpenActive"])},
            },
        ],
    },
    {
        name: "empty one of collections",
        filters: [
            {type: "Collections", operation: {type: "IncludesOneOf", collectionIds: new Set()}},
        ],
    },
    {
        name: "empty all of collections",
        filters: [
            {type: "Collections", operation: {type: "IncludesAllOf", collectionIds: new Set()}},
        ],
    },
    {
        name: "not empty collections",
        filters: [
            {type: "Collections", operation: {type: "ExcludesAllOf", collectionIds: new Set()}},
        ],
    },
    {
        name: "one of 1 collection",
        filters: [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collectionIds: new Set([generateId()])},
            },
        ],
    },
    {
        name: "all of 1 collection",
        filters: [
            {
                type: "Collections",
                operation: {type: "IncludesAllOf", collectionIds: new Set([generateId()])},
            },
        ],
    },
    {
        name: "not 1 collection",
        filters: [
            {
                type: "Collections",
                operation: {type: "ExcludesAllOf", collectionIds: new Set([generateId()])},
            },
        ],
    },
    {
        name: "one of 3 collections",
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collectionIds: new Set([generateId(), generateId(), generateId()]),
                },
            },
        ],
    },
    {
        name: "all of 3 collections",
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collectionIds: new Set([generateId(), generateId(), generateId()]),
                },
            },
        ],
    },
    {
        name: "not 3 collections",
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "ExcludesAllOf",
                    collectionIds: new Set([generateId(), generateId(), generateId()]),
                },
            },
        ],
    },
    {
        name: "actually empty collections",
        filters: [
            {
                type: "Collections",
                operation: {type: "IsEmpty"},
            },
        ],
    },
    {
        name: "one of empty priorities",
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set()},
            },
        ],
    },
    {
        name: "one of null priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set([null])},
            },
        ],
    },
    {
        name: "one of low priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["Low"])},
            },
        ],
    },
    {
        name: "one of medium priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["Medium"])},
            },
        ],
    },
    {
        name: "one of high priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["High"])},
            },
        ],
    },
    {
        name: "one of urgent priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["Urgent"])},
            },
        ],
    },
    {
        name: "one of null and low priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set([null, "Low"])},
            },
        ],
    },
    {
        name: "one of medium and high priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["Medium", "High"])},
            },
        ],
    },
    {
        name: "one of medium, high, and urgent priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["Medium", "High", "Urgent"])},
            },
        ],
    },
    {
        name: "one of all priorities",
        filters: [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: new Set([null, "Low", "Medium", "High", "Urgent"]),
                },
            },
        ],
    },
    {
        name: "none of empty priorities",
        filters: [
            {
                type: "Priority",
                operation: {type: "NoneOf", priorities: new Set()},
            },
        ],
    },
    {
        name: "none of null priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "NoneOf", priorities: new Set([null])},
            },
        ],
    },
    {
        name: "none of low priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "NoneOf", priorities: new Set(["Low"])},
            },
        ],
    },
    {
        name: "none of medium priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "NoneOf", priorities: new Set(["Medium"])},
            },
        ],
    },
    {
        name: "none of high priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "NoneOf", priorities: new Set(["High"])},
            },
        ],
    },
    {
        name: "none of urgent priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "NoneOf", priorities: new Set(["Urgent"])},
            },
        ],
    },
    {
        name: "none of null and low priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "NoneOf", priorities: new Set([null, "Low"])},
            },
        ],
    },
    {
        name: "none of medium and high priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "NoneOf", priorities: new Set(["Medium", "High"])},
            },
        ],
    },
    {
        name: "none of medium, high, and urgent priority",
        filters: [
            {
                type: "Priority",
                operation: {type: "NoneOf", priorities: new Set(["Medium", "High", "Urgent"])},
            },
        ],
    },
    {
        name: "none of all priorities",
        filters: [
            {
                type: "Priority",
                operation: {
                    type: "NoneOf",
                    priorities: new Set([null, "Low", "Medium", "High", "Urgent"]),
                },
            },
        ],
    },
    ...cast<Array<{name: string; operation: TaskQueryFilterAccountOperation}>>([
        {
            name: "empty",
            operation: {
                type: "OneOf",
                accounts: [],
            },
        },
        {
            name: "not empty",
            operation: {
                type: "NoneOf",
                accounts: [],
            },
        },
        {
            name: "current account",
            operation: {
                type: "OneOf",
                accounts: [{type: "CurrentAccount"}],
            },
        },
        {
            name: "not current account",
            operation: {
                type: "NoneOf",
                accounts: [{type: "CurrentAccount"}],
            },
        },
        {
            name: "no account",
            operation: {
                type: "OneOf",
                accounts: [{type: "NoAccount"}],
            },
        },
        {
            name: "not no account",
            operation: {
                type: "NoneOf",
                accounts: [{type: "NoAccount"}],
            },
        },
        {
            name: "1 account",
            operation: {
                type: "OneOf",
                accounts: [{type: "Account", accountId: generateId()}],
            },
        },
        {
            name: "not 1 account",
            operation: {
                type: "NoneOf",
                accounts: [{type: "Account", accountId: generateId()}],
            },
        },
        {
            name: "3 accounts",
            operation: {
                type: "OneOf",
                accounts: [
                    {type: "Account", accountId: generateId()},
                    {type: "Account", accountId: generateId()},
                    {type: "Account", accountId: generateId()},
                ],
            },
        },
        {
            name: "not 3 accounts",
            operation: {
                type: "NoneOf",
                accounts: [
                    {type: "Account", accountId: generateId()},
                    {type: "Account", accountId: generateId()},
                    {type: "Account", accountId: generateId()},
                ],
            },
        },
        {
            name: "account and current account",
            operation: {
                type: "OneOf",
                accounts: [{type: "Account", accountId: generateId()}, {type: "CurrentAccount"}],
            },
        },
        {
            name: "not account and current account",
            operation: {
                type: "NoneOf",
                accounts: [{type: "Account", accountId: generateId()}, {type: "CurrentAccount"}],
            },
        },
        {
            name: "account and current account different order",
            operation: {
                type: "OneOf",
                accounts: [{type: "CurrentAccount"}, {type: "Account", accountId: generateId()}],
            },
        },
        {
            name: "not account and current account different order",
            operation: {
                type: "NoneOf",
                accounts: [{type: "CurrentAccount"}, {type: "Account", accountId: generateId()}],
            },
        },
    ]).flatMap(operationTestCase =>
        [
            {name: "assignee", type: "Assignee" as const},
            {name: "creator", type: "Creator" as const},
            {name: "assigner", type: "Assigner" as const},
        ].map(filterType => ({
            name: `${filterType.name}: ${operationTestCase.name}`,
            filters: [
                {
                    type: filterType.type,
                    operation: operationTestCase.operation,
                },
            ],
        })),
    ),
    ...cast<Array<{name: string; operation: TaskQueryFilterDateOperation}>>([
        {
            name: "less than absolute date",
            operation: {
                type: "LessThan",
                date: {
                    type: "Absolute",
                    date: new CalendarDate(new GregorianCalendar(), 2023, 6, 7),
                },
            },
        },
        {
            name: "greater than absolute date",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "Absolute",
                    date: new CalendarDate(new GregorianCalendar(), 2023, 6, 7),
                },
            },
        },
        {
            name: "less than null absolute date",
            operation: {
                type: "LessThan",
                date: {type: "Absolute", date: null},
            },
        },
        {
            name: "greater than null absolute date",
            operation: {
                type: "GreaterThan",
                date: {type: "Absolute", date: null},
            },
        },
        {
            name: "less than relative today",
            operation: {
                type: "LessThan",
                date: {type: "RelativeToday"},
            },
        },
        {
            name: "less than relative after today in years",
            operation: {
                type: "LessThan",
                date: {
                    type: "RelativeAfterToday",
                    duration: {type: "Years", count: 1},
                },
            },
        },
        {
            name: "less than relative after today in months",
            operation: {
                type: "LessThan",
                date: {
                    type: "RelativeAfterToday",
                    duration: {type: "Months", count: 3},
                },
            },
        },
        {
            name: "less than relative after today in weeks",
            operation: {
                type: "LessThan",
                date: {
                    type: "RelativeAfterToday",
                    duration: {type: "Weeks", count: 6},
                },
            },
        },
        {
            name: "less than relative after today in days",
            operation: {
                type: "LessThan",
                date: {
                    type: "RelativeAfterToday",
                    duration: {type: "Days", count: 7},
                },
            },
        },
        {
            name: "less than relative before today in years",
            operation: {
                type: "LessThan",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {type: "Years", count: 1},
                },
            },
        },
        {
            name: "less than relative before today in months",
            operation: {
                type: "LessThan",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {type: "Months", count: 3},
                },
            },
        },
        {
            name: "less than relative before today in weeks",
            operation: {
                type: "LessThan",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {type: "Weeks", count: 6},
                },
            },
        },
        {
            name: "less than relative before today in days",
            operation: {
                type: "LessThan",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {type: "Days", count: 7},
                },
            },
        },
        {
            name: "greater than relative today",
            operation: {
                type: "GreaterThan",
                date: {type: "RelativeToday"},
            },
        },
        {
            name: "greater than relative after today in years",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "RelativeAfterToday",
                    duration: {type: "Years", count: 1},
                },
            },
        },
        {
            name: "greater than relative after today in months",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "RelativeAfterToday",
                    duration: {type: "Months", count: 3},
                },
            },
        },
        {
            name: "greater than relative after today in weeks",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "RelativeAfterToday",
                    duration: {type: "Weeks", count: 6},
                },
            },
        },
        {
            name: "greater than relative after today in days",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "RelativeAfterToday",
                    duration: {type: "Days", count: 7},
                },
            },
        },
        {
            name: "greater than relative before today in years",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {type: "Years", count: 1},
                },
            },
        },
        {
            name: "greater than relative before today in months",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {type: "Months", count: 3},
                },
            },
        },
        {
            name: "greater than relative before today in weeks",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {type: "Weeks", count: 6},
                },
            },
        },
        {
            name: "greater than relative before today in days",
            operation: {
                type: "GreaterThan",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {type: "Days", count: 7},
                },
            },
        },
    ]).flatMap(operationTestCase =>
        [
            {name: "due", type: "DueDate" as const},
            {name: "created", type: "CreatedDate" as const},
            {name: "assigned", type: "AssignedDate" as const},
            {name: "closed", type: "ClosedDate" as const},
            {name: "activated", type: "ActivatedDate" as const},
        ].map(filterType => ({
            name: `${filterType.name}: ${operationTestCase.name}`,
            filters: [
                {
                    type: filterType.type,
                    operation: operationTestCase.operation,
                },
            ],
        })),
    ),
    {
        name: "overdue due date",
        filters: [
            {
                type: "DueDate",
                operation: {type: "Overdue"},
            },
        ],
    },
    {
        name: "empty due date",
        filters: [
            {
                type: "DueDate",
                operation: {type: "IsEmpty"},
            },
        ],
    },
];

describe("task query filter binary encoding", () => {
    for (const {name, filters: filters1} of testCases) {
        test(`${name}`, () => {
            const buffer1 = serializeTaskQueryFilters(filters1);
            const filters2 = deserializeTaskQueryFilters(buffer1);
            const buffer2 = serializeTaskQueryFilters(filters2);

            expect(filters1).toEqual(filters2);
            expect(buffer1).toEqual(buffer2);
        });
    }
});
