import {SearchNaturalLanguageFilter} from "~/server/search/data/index/internal/parse_search_natural_language_query.js";
import {printSearchNaturalLanguageFilter} from "~/server/search/data/index/internal/print_search_natural_language_filter.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

const testTimeZone = assertTimeZone("UTC");
const testCurrentTime = new Date("2025-11-04T00:00:00.000Z");

const accounts = [
    createTestAccountModel({name: "John Smith"}),
    createTestAccountModel({name: "Emily Lin"}),
];

describe("printSearchNaturalLanguageFilter", () => {
    test("documents", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents",
        );
    });

    test("documents by john", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: {
                field: "MajorContributor",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents by John Smith",
        );
    });

    test("documents created by john", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: {
                field: "Creator",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created by John Smith",
        );
    });

    test("documents updated by john", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: {
                field: "AnyContributor",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated by John Smith",
        );
    });

    test("messages from emily", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
            account: {
                field: "MajorContributor",
                accounts: [{id: accounts[1]!.id, name: "Emily Lin"}],
            },
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "messages from Emily Lin",
        );
    });

    test("tasks", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Task", "TaskCollection"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks",
        );
    });

    test("documents created yesterday", () => {
        const yesterday = new Date(testCurrentTime);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: yesterday,
                    inclusiveUpperBoundDate: yesterday,
                },
            },
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created yesterday",
        );
    });

    test("documents created after a specific date", () => {
        const specificDate = new Date("2024-01-15T00:00:00.000Z");

        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: specificDate,
                    inclusiveUpperBoundDate: null,
                },
            },
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created after Jan 15th, 2024",
        );
    });

    test("documents created before a specific date", () => {
        const specificDate = new Date("2024-01-15T00:00:00.000Z");

        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: null,
                    inclusiveUpperBoundDate: specificDate,
                },
            },
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created before Jan 15th, 2024",
        );
    });

    test("documents by john created yesterday", () => {
        const yesterday = new Date(testCurrentTime);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const filter: SearchNaturalLanguageFilter = {
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
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents by John Smith created yesterday",
        );
    });

    test("tasks updated by multiple people", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Task", "TaskCollection"],
            account: {
                field: "AnyContributor",
                accounts: [
                    {id: accounts[0]!.id, name: "John Smith"},
                    {id: accounts[1]!.id, name: "Emily Lin"},
                ],
            },
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks updated by John Smith or Emily Lin",
        );
    });

    test("channels", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Channel"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "channels",
        );
    });

    test("posts", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Post"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "posts",
        );
    });

    test("chats", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Chat"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "chats",
        );
    });

    test("people", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Account"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "people",
        );
    });

    test("document comments", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["DocumentComment"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "document comments",
        );
    });

    test("post comments", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["PostComment"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "post comments",
        );
    });

    test("documents updated between two dates", () => {
        const startDate = new Date("2024-01-01T00:00:00.000Z");
        const endDate = new Date("2024-01-31T23:59:59.999Z");

        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: startDate,
                    inclusiveUpperBoundDate: endDate,
                },
            },
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated between Jan 1st, 2024 and Jan 31st, 2024",
        );
    });

    test("documents updated yesterday", () => {
        const yesterday = new Date(testCurrentTime);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: yesterday,
                    inclusiveUpperBoundDate: yesterday,
                },
            },
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated yesterday",
        );
    });

    test("documents created today", () => {
        const today = new Date(testCurrentTime);
        today.setHours(0, 0, 0, 0);

        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: today,
                    inclusiveUpperBoundDate: today,
                },
            },
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents created today",
        );
    });

    test("documents updated after a specific date", () => {
        const specificDate = new Date("2024-03-15T00:00:00.000Z");

        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: specificDate,
                    inclusiveUpperBoundDate: null,
                },
            },
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated after Mar 15th, 2024",
        );
    });

    test("documents updated before a specific date", () => {
        const specificDate = new Date("2024-03-15T00:00:00.000Z");

        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: {
                field: "LastUpdated",
                range: {
                    inclusiveLowerBoundDate: null,
                    inclusiveUpperBoundDate: specificDate,
                },
            },
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents updated before Mar 15th, 2024",
        );
    });

    test("task collection", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["TaskCollection"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "task collections",
        );
    });

    test("chat messages", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["ChatMessage"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "chat messages",
        );
    });

    test("channels created by emily", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Channel"],
            account: {
                field: "Creator",
                accounts: [{id: accounts[1]!.id, name: "Emily Lin"}],
            },
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "channels created by Emily Lin",
        );
    });

    test("tasks created by john", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Task", "TaskCollection"],
            account: {
                field: "Creator",
                accounts: [{id: accounts[0]!.id, name: "John Smith"}],
            },
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "tasks created by John Smith",
        );
    });

    test("chat messages from john sent yesterday", () => {
        const yesterday = new Date(testCurrentTime);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const filter: SearchNaturalLanguageFilter = {
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
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "chat messages from John Smith sent yesterday",
        );
    });

    test("documents and tasks", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document", "Task"],
            account: null,
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents and tasks",
        );
    });

    test("doesn’t print year if the date is in the current year", () => {
        const specificDate = new Date("2025-02-01T00:00:00.000Z");

        const filter: SearchNaturalLanguageFilter = {
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
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "posts by Emily Lin created after Feb 1st",
        );
    });

    test("doesn’t print ‘created’ twice", () => {
        const specificDate = new Date("2025-02-01T00:00:00.000Z");

        const filter: SearchNaturalLanguageFilter = {
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
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "posts by Emily Lin created after Feb 1st",
        );
    });

    test("posts updated by emily after a specific date", () => {
        const specificDate = new Date("2024-02-01T00:00:00.000Z");

        const filter: SearchNaturalLanguageFilter = {
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
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "posts by Emily Lin created after Feb 1st, 2024",
        );
    });

    test("chats created by multiple people", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Chat"],
            account: {
                field: "Creator",
                accounts: [
                    {id: accounts[0]!.id, name: "John Smith"},
                    {id: accounts[1]!.id, name: "Emily Lin"},
                ],
            },
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "chats created by John Smith or Emily Lin",
        );
    });

    test("unknown account", () => {
        const unknownAccountId = "unknown_id" as AccountId;

        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: {
                field: "MajorContributor",
                accounts: [{id: unknownAccountId, name: "Unknown"}],
            },
            time: null,
        };

        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toBe(
            "documents by Unknown",
        );
    });

    test("documents created last week - still parses dates", () => {
        const filter: SearchNaturalLanguageFilter = {
            entityTypes: ["Document"],
            account: null,
            time: {
                field: "Created",
                range: {
                    inclusiveLowerBoundDate: new Date("2023-12-25T07:00:00.000Z"),
                    inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                },
            },
        };
        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toEqual(
            "documents created between Dec 25th, 2023 and Jan 1st, 2024",
        );
    });

    test("documents by emily updated yesterday - combines account and date filters", () => {
        const filter: SearchNaturalLanguageFilter = {
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
        };
        expect(printSearchNaturalLanguageFilter(filter, testTimeZone, testCurrentTime)).toEqual(
            "documents by Emily Lin updated between Jan 3rd, 2024 and Jan 4th, 2024",
        );
    });
});
