import {CalendarDate} from "@internationalized/date";
import {SearchNaturalLanguageFilter} from "~/server/search/data/index/internal/parse_search_natural_language_query.js";
import {printSearchNaturalLanguageFilter} from "~/server/search/data/index/internal/print_search_natural_language_filter.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

const testTimeZone = assertTimeZone("UTC");
const testCurrentTime = new Date("2025-11-04T00:00:00.000Z");

const accounts = [
    createTestAccountModel({name: "John Smith"}),
    createTestAccountModel({name: "Emily Lin"}),
];

/**
 * As we add more filters, using a defaulted filter allows us to not have to
 * specify every item in a resulting filter.
 */
function createDefaultedFilter(
    overrides: Partial<SearchNaturalLanguageFilter> = {},
): SearchNaturalLanguageFilter {
    return {
        entityTypes: [],
        account: null,
        time: null,
        date: null,
        priority: null,
        openness: null,
        activeness: null,
        ...overrides,
    };
}

describe("printSearchNaturalLanguageFilter", () => {
    test("documents", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents",
        );
    });

    test("documents by john", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            account: {
                field: "MajorContributor",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents by John Smith",
        );
    });

    test("documents created by john", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            account: {
                field: "Creator",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created by John Smith",
        );
    });

    test("documents updated by john", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            account: {
                field: "AnyContributor",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated by John Smith",
        );
    });

    test("messages from emily", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
            account: {
                field: "MajorContributor",
                accounts: [{id: accounts[1]!.id, name: "Emily Lin"}],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "messages from Emily Lin",
        );
    });

    test("tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks",
        );
    });

    test("documents created yesterday", () => {
        const yesterday = new Date(testCurrentTime);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: yesterday,
                    inclusiveUpperBoundDate: yesterday,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created yesterday",
        );
    });

    test("documents created after a specific date", () => {
        const specificDate = new Date("2024-01-15T00:00:00.000Z");

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: specificDate,
                    inclusiveUpperBoundDate: null,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created after Jan 15th, 2024",
        );
    });

    test("documents created before a specific date", () => {
        const specificDate = new Date("2024-01-15T00:00:00.000Z");

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: null,
                    inclusiveUpperBoundDate: specificDate,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created before Jan 15th, 2024",
        );
    });

    test("documents by john created yesterday", () => {
        const yesterday = new Date(testCurrentTime);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            account: {
                field: "MajorContributor",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: yesterday,
                    inclusiveUpperBoundDate: yesterday,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents by John Smith created yesterday",
        );
    });

    test("tasks updated by multiple people", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            account: {
                field: "AnyContributor",
                accounts: [
                    {id: accounts[0]!.id, name: "John Smith"},
                    {id: accounts[1]!.id, name: "Emily Lin"},
                ],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks updated by John Smith or Emily Lin",
        );
    });

    test("channels", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Channel"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "channels",
        );
    });

    test("posts", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Post"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "posts",
        );
    });

    test("chats", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Chat"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "chats",
        );
    });

    test("people", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Account"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "people",
        );
    });

    test("document comments", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["DocumentComment"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "document comments",
        );
    });

    test("post comments", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["PostComment"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "post comments",
        );
    });

    test("documents updated between two dates", () => {
        const startDate = new Date("2024-01-01T00:00:00.000Z");
        const endDate = new Date("2024-01-31T23:59:59.999Z");

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: startDate,
                    inclusiveUpperBoundDate: endDate,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated between Jan 1st, 2024 and Jan 31st, 2024",
        );
    });

    test("documents updated yesterday", () => {
        const yesterday = new Date(testCurrentTime);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: yesterday,
                    inclusiveUpperBoundDate: yesterday,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated yesterday",
        );
    });

    test("documents created today", () => {
        const today = new Date(testCurrentTime);
        today.setHours(0, 0, 0, 0);

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: today,
                    inclusiveUpperBoundDate: today,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created today",
        );
    });

    test("documents updated after a specific date", () => {
        const specificDate = new Date("2024-03-15T00:00:00.000Z");

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: specificDate,
                    inclusiveUpperBoundDate: null,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated after Mar 15th, 2024",
        );
    });

    test("documents updated before a specific date", () => {
        const specificDate = new Date("2024-03-15T00:00:00.000Z");

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: null,
                    inclusiveUpperBoundDate: specificDate,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated before Mar 15th, 2024",
        );
    });

    test("task collection", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["TaskCollection"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "task collections",
        );
    });

    test("chat messages", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["ChatMessage"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "chat messages",
        );
    });

    test("channels created by emily", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Channel"],
            account: {
                field: "Creator",
                accounts: [{id: accounts[1]!.id, name: "Emily Lin"}],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "channels created by Emily Lin",
        );
    });

    test("tasks created by john", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            account: {
                field: "Creator",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks created by John Smith",
        );
    });

    test("chat messages from john sent yesterday", () => {
        const yesterday = new Date(testCurrentTime);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const filter = createDefaultedFilter({
            entityTypes: ["ChatMessage"],
            account: {
                field: "MajorContributor",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: yesterday,
                    inclusiveUpperBoundDate: yesterday,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "chat messages from John Smith sent yesterday",
        );
    });

    test("documents and tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Document", "Task"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents and tasks",
        );
    });

    test("doesn\u2019t print year if the date is in the current year", () => {
        const specificDate = new Date("2025-02-01T00:00:00.000Z");

        const filter = createDefaultedFilter({
            entityTypes: ["Post"],
            account: {
                field: "AnyContributor",
                accounts: [{id: accounts[1]!.id, name: "Emily Lin"}],
            },
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: specificDate,
                    inclusiveUpperBoundDate: null,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "posts by Emily Lin created after Feb 1st",
        );
    });

    test("doesn\u2019t print \u2018created\u2019 twice", () => {
        const specificDate = new Date("2025-02-01T00:00:00.000Z");

        const filter = createDefaultedFilter({
            entityTypes: ["Post"],
            account: {
                field: "AnyContributor",
                accounts: [{id: accounts[1]!.id, name: "Emily Lin"}],
            },
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: specificDate,
                    inclusiveUpperBoundDate: null,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "posts by Emily Lin created after Feb 1st",
        );
    });

    test("posts updated by emily after a specific date", () => {
        const specificDate = new Date("2024-02-01T00:00:00.000Z");

        const filter = createDefaultedFilter({
            entityTypes: ["Post"],
            account: {
                field: "AnyContributor",
                accounts: [{id: accounts[1]!.id, name: "Emily Lin"}],
            },
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: specificDate,
                    inclusiveUpperBoundDate: null,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "posts by Emily Lin created after Feb 1st, 2024",
        );
    });

    test("chats created by multiple people", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Chat"],
            account: {
                field: "Creator",
                accounts: [
                    {id: accounts[0]!.id, name: "John Smith"},
                    {id: accounts[1]!.id, name: "Emily Lin"},
                ],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "chats created by John Smith or Emily Lin",
        );
    });

    test("unknown account", () => {
        const unknownAccountId = "unknown_id" as AccountId;

        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            account: {
                field: "MajorContributor",
                accounts: [{id: unknownAccountId, name: "Unknown"}],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents by Unknown",
        );
    });

    test("documents created last week - still parses dates", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: new Date("2023-12-25T07:00:00.000Z"),
                    inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                },
            },
        });
        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toEqual(
            "documents created between Dec 25th, 2023 and Jan 1st, 2024",
        );
    });

    test("documents by emily updated yesterday - combines account and date filters", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Document"],
            account: {
                field: "MajorContributor",
                accounts: [{id: accounts[1]!.id, name: "Emily Lin"}],
            },
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                    inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                },
            },
        });
        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toEqual(
            "documents by Emily Lin updated between Jan 3rd, 2024 and Jan 4th, 2024",
        );
    });

    test("tasks assigned to john", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            account: {
                field: "Assignee",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks assigned to John Smith",
        );
    });

    test("tasks assigned to multiple people", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            account: {
                field: "Assignee",
                accounts: [
                    {id: accounts[0]!.id, name: "John Smith"},
                    {id: accounts[1]!.id, name: "Emily Lin"},
                ],
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks assigned to John Smith or Emily Lin",
        );
    });

    test("tasks due today", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            date: {
                field: "Due",
                range: {
                    inclusiveLowerBound: new CalendarDate(2025, 11, 4),
                    inclusiveUpperBound: new CalendarDate(2025, 11, 4),
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks due today",
        );
    });

    test("overdue tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            date: {
                field: "Due",
                range: {
                    inclusiveLowerBound: null,
                    inclusiveUpperBound: new CalendarDate(2025, 11, 4),
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks due before today",
        );
    });

    test("tasks due after a specific date", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            date: {
                field: "Due",
                range: {
                    inclusiveLowerBound: new CalendarDate(2025, 12, 1),
                    inclusiveUpperBound: null,
                },
            },
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks due after Dec 1st",
        );
    });

    test("high priority tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            priority: ["High"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks that are high priority",
        );
    });

    test("urgent tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            priority: ["Urgent"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks that are urgent priority",
        );
    });

    test("high and urgent priority tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            priority: ["Urgent", "High"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks that are urgent or high priority",
        );
    });

    test("open tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            openness: ["Open"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks that are open",
        );
    });

    test("closed tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            openness: ["Closed"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks that are closed",
        );
    });

    test("active tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            activeness: ["Active"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks that are active",
        );
    });

    test("inactive tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            activeness: ["Inactive"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks that are inactive",
        );
    });

    test("high priority open tasks", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            priority: ["High"],
            openness: ["Open"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks that are open and high priority",
        );
    });

    test("urgent active tasks assigned to john", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            account: {
                field: "Assignee",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
            priority: ["Urgent"],
            activeness: ["Active"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks assigned to John Smith that are active and urgent priority",
        );
    });

    test("overdue high priority tasks assigned to emily", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            account: {
                field: "Assignee",
                accounts: [{id: accounts[1]!.id, name: "Emily Lin"}],
            },
            date: {
                field: "Due",
                range: {
                    inclusiveLowerBound: null,
                    inclusiveUpperBound: new CalendarDate(2025, 11, 4),
                },
            },
            priority: ["High"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks by Emily Lin due before today that are high priority",
        );
    });

    test("high priority open active tasks due today", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            date: {
                field: "Due",
                range: {
                    inclusiveLowerBound: new CalendarDate(2025, 11, 4),
                    inclusiveUpperBound: new CalendarDate(2025, 11, 4),
                },
            },
            priority: ["High"],
            openness: ["Open"],
            activeness: ["Active"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks due today that are open, active, and high priority",
        );
    });

    test("high, medium, low priority open active tasks due today", () => {
        const filter = createDefaultedFilter({
            entityTypes: ["Task", "TaskCollection"],
            date: {
                field: "Due",
                range: {
                    inclusiveLowerBound: new CalendarDate(2025, 11, 4),
                    inclusiveUpperBound: new CalendarDate(2025, 11, 4),
                },
            },
            priority: ["High", "Medium", "Low"],
            openness: ["Open"],
            activeness: ["Active"],
        });

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks due today that are open, active, and high, medium, or low priority",
        );
    });
});
