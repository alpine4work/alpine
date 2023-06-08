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
        filters: [{type: "Status", operation: {type: "OneOf", statuses: new Set(["Open"])}}],
    },
    {
        name: "not open status",
        filters: [{type: "Status", operation: {type: "NoneOf", statuses: new Set(["Open"])}}],
    },
    {
        name: "active status",
        filters: [{type: "Status", operation: {type: "OneOf", statuses: new Set(["Active"])}}],
    },
    {
        name: "not active status",
        filters: [{type: "Status", operation: {type: "NoneOf", statuses: new Set(["Active"])}}],
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
            {type: "Status", operation: {type: "OneOf", statuses: new Set(["Open", "Active"])}},
        ],
    },
    {
        name: "not open and active status",
        filters: [
            {type: "Status", operation: {type: "NoneOf", statuses: new Set(["Open", "Active"])}},
        ],
    },
    {
        name: "open and active status in different order",
        filters: [
            {type: "Status", operation: {type: "OneOf", statuses: new Set(["Active", "Open"])}},
        ],
    },
    {
        name: "not open and active status in different order",
        filters: [
            {type: "Status", operation: {type: "NoneOf", statuses: new Set(["Active", "Open"])}},
        ],
    },
    {
        name: "multiple status filters",
        filters: [
            {type: "Status", operation: {type: "OneOf", statuses: new Set(["Open"])}},
            {type: "Status", operation: {type: "NoneOf", statuses: new Set(["Closed"])}},
            {type: "Status", operation: {type: "OneOf", statuses: new Set(["Open"])}},
            {type: "Status", operation: {type: "OneOf", statuses: new Set(["Open", "Active"])}},
        ],
    },
    {
        name: "empty collections",
        filters: [{type: "Collections", operation: {type: "OneOf", collectionIds: new Set()}}],
    },
    {
        name: "not empty collections",
        filters: [{type: "Collections", operation: {type: "NoneOf", collectionIds: new Set()}}],
    },
    {
        name: "1 collection",
        filters: [
            {
                type: "Collections",
                operation: {type: "OneOf", collectionIds: new Set([generateId()])},
            },
        ],
    },
    {
        name: "not 1 collection",
        filters: [
            {
                type: "Collections",
                operation: {type: "NoneOf", collectionIds: new Set([generateId()])},
            },
        ],
    },
    {
        name: "3 collections",
        filters: [
            {
                type: "Collections",
                operation: {
                    type: "OneOf",
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
                    type: "NoneOf",
                    collectionIds: new Set([generateId(), generateId(), generateId()]),
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
            name: "less than null date",
            operation: {type: "LessThanOrEqualTo", date: null},
        },
        {
            name: "greater than null date",
            operation: {type: "GreaterThanOrEqualTo", date: null},
        },
        {
            name: "less than absolute date",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "Absolute",
                    date: new CalendarDate(new GregorianCalendar(), 2023, 6, 7),
                },
            },
        },
        {
            name: "greater than absolute date",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "Absolute",
                    date: new CalendarDate(new GregorianCalendar(), 2023, 6, 7),
                },
            },
        },
        {
            name: "less than relative after today in years",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {years: 1},
                },
            },
        },
        {
            name: "less than relative after today in months",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {months: 3},
                },
            },
        },
        {
            name: "less than relative after today in weeks",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {weeks: 6},
                },
            },
        },
        {
            name: "less than relative after today in days",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {days: 7},
                },
            },
        },
        {
            name: "less than relative after today in months and days",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {months: 1, days: 7},
                },
            },
        },
        {
            name: "less than relative before today in years",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {years: 1},
                },
            },
        },
        {
            name: "less than relative before today in months",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {months: 3},
                },
            },
        },
        {
            name: "less than relative before today in weeks",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {weeks: 6},
                },
            },
        },
        {
            name: "less than relative before today in days",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {days: 7},
                },
            },
        },
        {
            name: "less than relative before today in months and days",
            operation: {
                type: "LessThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {months: 1, days: 7},
                },
            },
        },
        {
            name: "greater than relative after today in years",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {years: 1},
                },
            },
        },
        {
            name: "greater than relative after today in months",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {months: 3},
                },
            },
        },
        {
            name: "greater than relative after today in weeks",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {weeks: 6},
                },
            },
        },
        {
            name: "greater than relative after today in days",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {days: 7},
                },
            },
        },
        {
            name: "greater than relative after today in months and days",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeAfterToday",
                    duration: {months: 1, days: 7},
                },
            },
        },
        {
            name: "greater than relative before today in years",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {years: 1},
                },
            },
        },
        {
            name: "greater than relative before today in months",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {months: 3},
                },
            },
        },
        {
            name: "greater than relative before today in weeks",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {weeks: 6},
                },
            },
        },
        {
            name: "greater than relative before today in days",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {days: 7},
                },
            },
        },
        {
            name: "greater than relative before today in months and days",
            operation: {
                type: "GreaterThanOrEqualTo",
                date: {
                    type: "RelativeBeforeToday",
                    duration: {months: 1, days: 7},
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
