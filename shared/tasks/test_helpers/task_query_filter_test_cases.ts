import {CalendarDate, GregorianCalendar} from "@internationalized/date";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateId} from "~/shared/id/id.js";
import {
    TaskQueryFilter,
    TaskQueryFilterAccountOperation,
    TaskQueryFilterCreatorAccountOperation,
    TaskQueryFilterDateOperation,
} from "~/shared/tasks/task_query_filter.js";

export const taskQueryFilterTestCases: Array<{name: string; filters: Array<TaskQueryFilter>}> = [
    {
        name: "empty",
        filters: [],
    },
    {
        name: "open status",
        filters: [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive"])},
            },
        ],
    },
    {
        name: "not open status",
        filters: [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenInactive"])},
            },
        ],
    },
    {
        name: "active status",
        filters: [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenActive"])},
            },
        ],
    },
    {
        name: "not active status",
        filters: [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["OpenActive"])},
            },
        ],
    },
    {
        name: "closed status",
        filters: [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
            },
        ],
    },
    {
        name: "not closed status",
        filters: [
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["Closed"])},
            },
        ],
    },
    {
        name: "open and active status",
        filters: [
            {
                type: "DisplayStatus",
                operation: {
                    type: "OneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive"]),
                },
            },
        ],
    },
    {
        name: "not open and active status",
        filters: [
            {
                type: "DisplayStatus",
                operation: {
                    type: "NoneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive"]),
                },
            },
        ],
    },
    {
        name: "open and active status in different order",
        filters: [
            {
                type: "DisplayStatus",
                operation: {
                    type: "OneOf",
                    displayStatuses: new Set(["OpenActive", "OpenInactive"]),
                },
            },
        ],
    },
    {
        name: "not open and active status in different order",
        filters: [
            {
                type: "DisplayStatus",
                operation: {
                    type: "NoneOf",
                    displayStatuses: new Set(["OpenActive", "OpenInactive"]),
                },
            },
        ],
    },
    {
        name: "multiple status filters",
        filters: [
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive"])},
            },
            {
                type: "DisplayStatus",
                operation: {type: "NoneOf", displayStatuses: new Set(["Closed"])},
            },
            {
                type: "DisplayStatus",
                operation: {type: "OneOf", displayStatuses: new Set(["OpenInactive"])},
            },
            {
                type: "DisplayStatus",
                operation: {
                    type: "OneOf",
                    displayStatuses: new Set(["OpenInactive", "OpenActive"]),
                },
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
    {
        name: "one of project layout",
        filters: [
            {
                type: "Layout",
                operation: {type: "OneOf", layouts: ["Project"]},
            },
        ],
    },
    {
        name: "none of project layout",
        filters: [
            {
                type: "Layout",
                operation: {type: "NoneOf", layouts: ["Project"]},
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
                accounts: [{type: "MissingAccount"}],
            },
        },
        {
            name: "not no account",
            operation: {
                type: "NoneOf",
                accounts: [{type: "MissingAccount"}],
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
    ]).flatMap(operationTestCase => {
        const testCases: Array<{name: string; filters: Array<TaskQueryFilter>}> = [];

        if (
            operationTestCase.operation.accounts.every(account => account.type !== "MissingAccount")
        ) {
            testCases.push({
                name: `creator: ${operationTestCase.name}`,
                filters: [
                    {
                        type: "Creator",
                        operation:
                            operationTestCase.operation as TaskQueryFilterCreatorAccountOperation,
                    },
                ],
            });
        }

        testCases.push({
            name: `assignee: ${operationTestCase.name}`,
            filters: [
                {
                    type: "Assignee",
                    operation: operationTestCase.operation,
                },
            ],
        });

        testCases.push({
            name: `assigner: ${operationTestCase.name}`,
            filters: [
                {
                    type: "Assigner",
                    operation: operationTestCase.operation,
                },
            ],
        });

        return testCases;
    }),
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
    {
        name: "includes empty title",
        filters: [
            {
                type: "Title",
                operation: {type: "Includes", titleQuery: ""},
            },
        ],
    },
    {
        name: "excludes empty title",
        filters: [
            {
                type: "Title",
                operation: {type: "Excludes", titleQuery: ""},
            },
        ],
    },
    {
        name: "includes title substring",
        filters: [
            {
                type: "Title",
                operation: {type: "Includes", titleQuery: "foo bar"},
            },
        ],
    },
    {
        name: "excludes title substring",
        filters: [
            {
                type: "Title",
                operation: {type: "Excludes", titleQuery: "foo bar"},
            },
        ],
    },
    {
        name: "includes title substring and priority after",
        filters: [
            {
                type: "Title",
                operation: {type: "Includes", titleQuery: "foo bar"},
            },
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["High"])},
            },
        ],
    },
    {
        name: "excludes title substring and priority after",
        filters: [
            {
                type: "Title",
                operation: {type: "Excludes", titleQuery: "foo bar"},
            },
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["High"])},
            },
        ],
    },
];
