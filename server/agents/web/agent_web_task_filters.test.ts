import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {
    parseAgentWebTaskFilters,
    printAgentWebTaskFilters,
} from "~/server/agents/web/agent_web_task_filters.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {normalizeApiTaskFilters} from "~/shared/api/content/normalize_api_task_filters.js";
import {ApiTaskFilter} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";

const storage = createAgentWebSessionStorageForTest(generateId<SpaceId>());

/**
 * Asserts that `filters` print to exactly `searchParamsString` and that parsing
 * `searchParamsString` returns exactly `normalizeApiTaskFilters(filters)`. The
 * printed string is inline in each test so the aesthetics of the format are easy
 * to review.
 */
async function expectTaskFilterFormat(
    filters: ReadonlyArray<ApiTaskFilter>,
    searchParamsString: string,
): Promise<void> {
    expect({
        printed: await printAgentWebTaskFilters(storage, filters),
        parsed: await parseAgentWebTaskFilters(storage, new URLSearchParams(searchParamsString)),
    }).toEqual({
        printed: searchParamsString,
        parsed: normalizeApiTaskFilters(filters),
    });
}

async function createAccountLinkForTest(
    name: string,
    {bot = false}: {bot?: boolean} = {},
): Promise<AccountId> {
    const id = generateId<AccountId>();

    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Account",
        id,
        title: name,
        shortName: name.split(" ")[0]!,
        bot: bot ? {id: generateId<BotId>()} : undefined,
    });

    return id;
}

async function createTaskCollectionLinkForTest(name: string): Promise<TaskCollectionId> {
    const id = generateId<TaskCollectionId>();
    await createAgentWebPageStoredLinkPathname(storage, {type: "TaskCollection", id, title: name});
    return id;
}

test("prints no search params for no filters", async () => {
    await expectTaskFilterFormat([], "");
});

test("prints an open status filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Status", operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]}}],
        "status=open",
    );
});

test("prints an active status filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Status", operation: {type: "OneOf", statuses: [{type: "Open", isActive: true}]}}],
        "status=open-active",
    );
});

test("prints a closed status filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Status", operation: {type: "OneOf", statuses: [{type: "Closed"}]}}],
        "status=closed",
    );
});

test("prints a status filter with multiple statuses", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Status",
                operation: {
                    type: "OneOf",
                    statuses: [
                        {type: "Open", isActive: false},
                        {type: "Open", isActive: true},
                    ],
                },
            },
        ],
        "status=open&status=open-active",
    );
});

test("prints a status filter deduping repeated statuses", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Status",
                operation: {
                    type: "OneOf",
                    statuses: [
                        {type: "Open", isActive: false},
                        {type: "Open", isActive: false},
                        {type: "Closed"},
                    ],
                },
            },
        ],
        "status=open&status=closed",
    );
});

test("prints a status filter with no statuses", async () => {
    await expectTaskFilterFormat(
        [{type: "Status", operation: {type: "OneOf", statuses: []}}],
        "status=",
    );
});

test("prints a negated status filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Status", operation: {type: "NoneOf", statuses: [{type: "Closed"}]}}],
        "status[not]=closed",
    );
});

test("prints a negated status filter with no statuses", async () => {
    await expectTaskFilterFormat(
        [{type: "Status", operation: {type: "NoneOf", statuses: []}}],
        "status[not]=",
    );
});

test("prints a negated status filter with multiple statuses", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Status",
                operation: {
                    type: "NoneOf",
                    statuses: [{type: "Open", isActive: true}, {type: "Closed"}],
                },
            },
        ],
        "status[not]=open-active&status[not]=closed",
    );
});

test("prints positive and negated status filters together", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
            },
            {type: "Status", operation: {type: "NoneOf", statuses: [{type: "Closed"}]}},
        ],
        "status=open&status[not]=closed",
    );
});

test("prints two status filters of the same kind with a break param", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
            },
            {type: "Status", operation: {type: "OneOf", statuses: [{type: "Closed"}]}},
        ],
        "status=open&break&status=closed",
    );
});

test("prints two empty status filters with a break param", async () => {
    await expectTaskFilterFormat(
        [
            {type: "Status", operation: {type: "OneOf", statuses: []}},
            {type: "Status", operation: {type: "OneOf", statuses: []}},
        ],
        "status=&break&status=",
    );
});

test("prints a high priority filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Priority", operation: {type: "OneOf", priorities: [{type: "High"}]}}],
        "priority=high",
    );
});

test("prints a priority filter with every priority", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: [{type: "Low"}, {type: "Medium"}, {type: "High"}, {type: "Urgent"}],
                },
            },
        ],
        "priority=low&priority=medium&priority=high&priority=urgent",
    );
});

test("prints a missing priority filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Priority", operation: {type: "OneOf", priorities: [null]}}],
        "priority=none",
    );
});

test("prints a priority filter mixing a priority and no priority", async () => {
    await expectTaskFilterFormat(
        [{type: "Priority", operation: {type: "OneOf", priorities: [{type: "High"}, null]}}],
        "priority=high&priority=none",
    );
});

test("prints a priority filter deduping repeated priorities", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: [{type: "High"}, {type: "High"}, null, null],
                },
            },
        ],
        "priority=high&priority=none",
    );
});

test("prints a priority filter with no priorities", async () => {
    await expectTaskFilterFormat(
        [{type: "Priority", operation: {type: "OneOf", priorities: []}}],
        "priority=",
    );
});

test("prints a negated priority filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Priority", operation: {type: "NoneOf", priorities: [{type: "Urgent"}]}}],
        "priority[not]=urgent",
    );
});

test("prints a negated missing priority filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Priority", operation: {type: "NoneOf", priorities: [null]}}],
        "priority[not]=none",
    );
});

test("prints a layout filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Layout", operation: {type: "OneOf", layouts: [{type: "Project"}]}}],
        "layout=project",
    );
});

test("prints a negated layout filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Layout", operation: {type: "NoneOf", layouts: [{type: "Project"}]}}],
        "layout[not]=project",
    );
});

test("prints a title filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "launch"}}],
        "title=launch",
    );
});

test("prints a title filter with spaces", async () => {
    await expectTaskFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "fix the bug"}}],
        "title=fix+the+bug",
    );
});

test("prints a title filter with no text", async () => {
    await expectTaskFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: ""}}],
        "title=",
    );
});

test("prints a negated title filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Title", operation: {type: "Excludes", titleQuery: "draft"}}],
        "title[not]=draft",
    );
});

test("prints multiple title filters", async () => {
    await expectTaskFilterFormat(
        [
            {type: "Title", operation: {type: "Includes", titleQuery: "launch"}},
            {type: "Title", operation: {type: "Excludes", titleQuery: "draft"}},
        ],
        "title=launch&title[not]=draft",
    );
});

test("prints two title filters of the same kind without a break param", async () => {
    await expectTaskFilterFormat(
        [
            {type: "Title", operation: {type: "Includes", titleQuery: "alpha"}},
            {type: "Title", operation: {type: "Includes", titleQuery: "beta"}},
        ],
        "title=alpha&title=beta",
    );
});

test("prints a title filter escaping URL search param characters", async () => {
    await expectTaskFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "50% & more #1 + tax"}}],
        "title=50%25+%26+more+%231+%2B+tax",
    );
});

test("prints a title filter percent encoding unicode", async () => {
    await expectTaskFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "café ☕"}}],
        "title=caf%C3%A9+%E2%98%95",
    );
});

test("prints a title filter percent encoding WHATWG URL query characters", async () => {
    await expectTaskFilterFormat(
        // eslint-disable-next-line cyberworlds/string-quotes -- Testing the literal straight quote escape.
        [{type: "Title", operation: {type: "Includes", titleQuery: '"a" < b > c'}}],
        "title=%22a%22+%3C+b+%3E+c",
    );
});

test("prints a title filter replacing lone surrogates", async () => {
    // Lone surrogates can't round trip: they aren't encodable as UTF-8 so both this
    // format and the binary task filter serialization replace them with U+FFFD.
    expect(
        await printAgentWebTaskFilters(storage, [
            {type: "Title", operation: {type: "Includes", titleQuery: "a\ud800b"}},
        ]),
    ).toBe("title=a%EF%BF%BDb");
});

test("prints a title filter without escaping equals signs", async () => {
    await expectTaskFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "a=b"}}],
        "title=a=b",
    );
});

test("prints a title filter escaping control characters", async () => {
    await expectTaskFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "a\tb"}}],
        "title=a%09b",
    );
});

test("prints a title filter for text which looks like a reserved value", async () => {
    await expectTaskFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "none"}}],
        "title=none",
    );
});

test("prints an assignee filter with an account", async () => {
    const accountId = await createAccountLinkForTest("John Doe");

    await expectTaskFilterFormat(
        [
            {
                type: "Assignee",
                operation: {type: "OneOf", accounts: [{type: "Account", account: {id: accountId}}]},
            },
        ],
        "assignee=john-doe",
    );
});

test("prints an assignee filter with a bot account", async () => {
    const accountId = await createAccountLinkForTest("Melvin", {bot: true});

    await expectTaskFilterFormat(
        [
            {
                type: "Assignee",
                operation: {type: "OneOf", accounts: [{type: "Account", account: {id: accountId}}]},
            },
        ],
        "assignee=melvin",
    );
});

test("prints unambiguous assignee filters for a human and a bot with the same name", async () => {
    const humanId = await createAccountLinkForTest("Caleb");
    const botId = await createAccountLinkForTest("Caleb", {bot: true});

    await expectTaskFilterFormat(
        [
            {
                type: "Assignee",
                operation: {type: "OneOf", accounts: [{type: "Account", account: {id: humanId}}]},
            },
            {
                type: "Assigner",
                operation: {type: "OneOf", accounts: [{type: "Account", account: {id: botId}}]},
            },
        ],
        "assignee=caleb&assigner=caleb-2",
    );
});

test("prints a full account path for an account named like a reserved value", async () => {
    const accountId = await createAccountLinkForTest("Me");

    await expectTaskFilterFormat(
        [
            {
                type: "Assignee",
                operation: {type: "OneOf", accounts: [{type: "Account", account: {id: accountId}}]},
            },
        ],
        "assignee=/human/me",
    );
});

test("prints an assignee filter with the current account", async () => {
    await expectTaskFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}}],
        "assignee=me",
    );
});

test("prints an unassigned tasks filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: [{type: "MissingAccount"}]}}],
        "assignee=none",
    );
});

test("prints an assignee filter with multiple accounts", async () => {
    const accountId = await createAccountLinkForTest("John Doe");

    await expectTaskFilterFormat(
        [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", account: {id: accountId}},
                        {type: "CurrentAccount"},
                    ],
                },
            },
        ],
        "assignee=john-doe&assignee=me",
    );
});

test("prints an assignee filter deduping repeated accounts", async () => {
    const accountId = await createAccountLinkForTest("John Doe");

    await expectTaskFilterFormat(
        [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", account: {id: accountId}},
                        {type: "Account", account: {id: accountId}},
                        {type: "CurrentAccount"},
                        {type: "CurrentAccount"},
                    ],
                },
            },
        ],
        "assignee=john-doe&assignee=me",
    );
});

test("prints an assignee filter with no accounts", async () => {
    await expectTaskFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: []}}],
        "assignee=",
    );
});

test("prints a negated assignee filter", async () => {
    const accountId = await createAccountLinkForTest("John Doe");

    await expectTaskFilterFormat(
        [
            {
                type: "Assignee",
                operation: {
                    type: "NoneOf",
                    accounts: [{type: "Account", account: {id: accountId}}],
                },
            },
        ],
        "assignee[not]=john-doe",
    );
});

test("prints an assigned tasks filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Assignee", operation: {type: "NoneOf", accounts: [{type: "MissingAccount"}]}}],
        "assignee[not]=none",
    );
});

test("prints a creator filter with an account", async () => {
    const accountId = await createAccountLinkForTest("John Doe");

    await expectTaskFilterFormat(
        [
            {
                type: "Creator",
                operation: {type: "OneOf", accounts: [{type: "Account", account: {id: accountId}}]},
            },
        ],
        "creator=john-doe",
    );
});

test("prints a negated creator filter with the current account", async () => {
    await expectTaskFilterFormat(
        [{type: "Creator", operation: {type: "NoneOf", accounts: [{type: "CurrentAccount"}]}}],
        "creator[not]=me",
    );
});

test("prints an assigner filter with the current account", async () => {
    await expectTaskFilterFormat(
        [{type: "Assigner", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}}],
        "assigner=me",
    );
});

test("prints a collection filter", async () => {
    const collectionId = await createTaskCollectionLinkForTest("Roadmap");

    await expectTaskFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [{id: collectionId}]},
            },
        ],
        "collection=roadmap",
    );
});

test("prints a collection filter with multiple collections", async () => {
    const engineeringId = await createTaskCollectionLinkForTest("Engineering");
    const designId = await createTaskCollectionLinkForTest("Design");

    await expectTaskFilterFormat(
        [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collections: [{id: engineeringId}, {id: designId}],
                },
            },
        ],
        "collection=engineering&collection=design",
    );
});

test("prints a collection filter deduping repeated collections", async () => {
    const collectionId = await createTaskCollectionLinkForTest("Roadmap");

    await expectTaskFilterFormat(
        [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collections: [{id: collectionId}, {id: collectionId}],
                },
            },
        ],
        "collection=roadmap",
    );
});

test("prints a collection filter with no collections", async () => {
    await expectTaskFilterFormat(
        [{type: "Collections", operation: {type: "IncludesOneOf", collections: []}}],
        "collection=",
    );
});

test("prints a collection filter requiring every collection", async () => {
    const engineeringId = await createTaskCollectionLinkForTest("Engineering");
    const designId = await createTaskCollectionLinkForTest("Design");

    await expectTaskFilterFormat(
        [
            {
                type: "Collections",
                operation: {
                    type: "IncludesAllOf",
                    collections: [{id: engineeringId}, {id: designId}],
                },
            },
        ],
        "collection[all]=engineering&collection[all]=design",
    );
});

test("prints a negated collection filter", async () => {
    const collectionId = await createTaskCollectionLinkForTest("Archive");

    await expectTaskFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "ExcludesAllOf", collections: [{id: collectionId}]},
            },
        ],
        "collection[not]=archive",
    );
});

test("prints a tasks in no collections filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Collections", operation: {type: "IsEmpty"}}],
        "collection=none",
    );
});

test("prints a full collection path for a collection named like a reserved value", async () => {
    const collectionId = await createTaskCollectionLinkForTest("None");

    await expectTaskFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [{id: collectionId}]},
            },
        ],
        "collection=/task-collection/none",
    );
});

test("prints a collection filter next to a tasks in no collections filter", async () => {
    const collectionId = await createTaskCollectionLinkForTest("Roadmap");

    await expectTaskFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [{id: collectionId}]},
            },
            {type: "Collections", operation: {type: "IsEmpty"}},
        ],
        "collection=roadmap&collection=none",
    );
});

test("prints interleaved collection filters without break params", async () => {
    const engineeringId = await createTaskCollectionLinkForTest("Engineering");
    const designId = await createTaskCollectionLinkForTest("Design");
    const roadmapId = await createTaskCollectionLinkForTest("Roadmap");
    const archiveId = await createTaskCollectionLinkForTest("Archive");

    await expectTaskFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [{id: engineeringId}]},
            },
            {
                type: "Collections",
                operation: {type: "IncludesAllOf", collections: [{id: designId}]},
            },
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [{id: roadmapId}]},
            },
            {
                type: "Collections",
                operation: {type: "IncludesAllOf", collections: [{id: archiveId}]},
            },
        ],
        "collection=engineering&collection[all]=design&collection=roadmap&collection[all]=archive",
    );
});

test("prints adjacent collection filters of the same kind with a break param", async () => {
    const engineeringId = await createTaskCollectionLinkForTest("Engineering");
    const designId = await createTaskCollectionLinkForTest("Design");

    await expectTaskFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [{id: engineeringId}]},
            },
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [{id: designId}]},
            },
        ],
        "collection=engineering&break&collection=design",
    );
});

test("prints an overdue filter", async () => {
    await expectTaskFilterFormat([{type: "Due", operation: {type: "Overdue"}}], "due=overdue");
});

test("prints a tasks with no due date filter", async () => {
    await expectTaskFilterFormat([{type: "Due", operation: {type: "IsEmpty"}}], "due=none");
});

test("prints a due before an absolute date filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Due",
                operation: {type: "LessThan", date: {type: "Absolute", date: "2026-07-12"}},
            },
        ],
        "due[before]=2026-07-12",
    );
});

test("prints a due after an absolute date filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Due",
                operation: {type: "GreaterThan", date: {type: "Absolute", date: "2026-07-12"}},
            },
        ],
        "due[after]=2026-07-12",
    );
});

test("prints a due before today filter", async () => {
    await expectTaskFilterFormat(
        [{type: "Due", operation: {type: "LessThan", date: {type: "RelativeToday"}}}],
        "due[before]=today",
    );
});

test("prints a due after a relative days filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Due",
                operation: {
                    type: "GreaterThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", days: 3}},
                },
            },
        ],
        "due[after]=today+3d",
    );
});

test("prints a due before a relative weeks filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Due",
                operation: {
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Weeks", weeks: 2}},
                },
            },
        ],
        "due[before]=today+2w",
    );
});

test("prints a due after a relative months in the past filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Due",
                operation: {
                    type: "GreaterThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Months", months: 6}},
                },
            },
        ],
        "due[after]=today-6mo",
    );
});

test("prints a due before a relative years in the past filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Due",
                operation: {
                    type: "LessThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Years", years: 1}},
                },
            },
        ],
        "due[before]=today-1y",
    );
});

test("prints a due date range with two filters", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Due",
                operation: {type: "GreaterThan", date: {type: "Absolute", date: "2026-07-01"}},
            },
            {
                type: "Due",
                operation: {type: "LessThan", date: {type: "Absolute", date: "2026-08-01"}},
            },
        ],
        "due[after]=2026-07-01&due[before]=2026-08-01",
    );
});

test("prints a due date filter whose date hasn\u2019t been chosen yet", async () => {
    await expectTaskFilterFormat(
        [{type: "Due", operation: {type: "LessThan", date: {type: "Absolute", date: null}}}],
        "due[before]=",
    );
});

test("prints a created date filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "CreatedDate",
                operation: {type: "GreaterThan", date: {type: "Absolute", date: "2026-01-01"}},
            },
        ],
        "created[after]=2026-01-01",
    );
});

test("prints an assigned date filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "AssignedDate",
                operation: {
                    type: "LessThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Weeks", weeks: 1}},
                },
            },
        ],
        "assigned[before]=today-1w",
    );
});

test("prints a closed date filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "ClosedDate",
                operation: {
                    type: "GreaterThan",
                    date: {type: "RelativeBeforeToday", duration: {type: "Days", days: 3}},
                },
            },
        ],
        "closed[after]=today-3d",
    );
});

test("prints an activated date filter", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "ActivatedDate",
                operation: {type: "LessThan", date: {type: "Absolute", date: "2026-06-30"}},
            },
        ],
        "activated[before]=2026-06-30",
    );
});

test("prints a combined set of filters", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
            },
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: [{type: "High"}, {type: "Urgent"}]},
            },
            {
                type: "Due",
                operation: {
                    type: "LessThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Weeks", weeks: 1}},
                },
            },
        ],
        "status=open&priority=high&priority=urgent&due[before]=today+1w",
    );
});

test("prints non-adjacent status filters without a break param", async () => {
    await expectTaskFilterFormat(
        [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
            },
            {type: "Title", operation: {type: "Includes", titleQuery: "launch"}},
            {type: "Status", operation: {type: "OneOf", statuses: [{type: "Closed"}]}},
        ],
        "status=open&title=launch&status=closed",
    );
});

test("normalizes repeated statuses keeping the first occurrence", () => {
    expect(
        normalizeApiTaskFilters([
            {
                type: "Status",
                operation: {
                    type: "OneOf",
                    statuses: [{type: "Closed"}, {type: "Open", isActive: false}, {type: "Closed"}],
                },
            },
        ]),
    ).toEqual([
        {
            type: "Status",
            operation: {
                type: "OneOf",
                statuses: [{type: "Closed"}, {type: "Open", isActive: false}],
            },
        },
    ]);
});

test("normalizes repeated accounts in an assignee filter", () => {
    const accountId = generateId<AccountId>();

    expect(
        normalizeApiTaskFilters([
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", account: {id: accountId}},
                        {type: "MissingAccount"},
                        {type: "Account", account: {id: accountId}},
                    ],
                },
            },
        ]),
    ).toEqual([
        {
            type: "Assignee",
            operation: {
                type: "OneOf",
                accounts: [{type: "Account", account: {id: accountId}}, {type: "MissingAccount"}],
            },
        },
    ]);
});

test("normalization leaves distinct filters unchanged", () => {
    const filters: ReadonlyArray<ApiTaskFilter> = [
        {type: "Title", operation: {type: "Includes", titleQuery: "launch"}},
        {type: "Due", operation: {type: "Overdue"}},
        {type: "Due", operation: {type: "LessThan", date: {type: "Absolute", date: null}}},
        {
            type: "Priority",
            operation: {type: "OneOf", priorities: [{type: "High"}, null]},
        },
    ];

    expect(normalizeApiTaskFilters(filters)).toEqual(filters);
});

test("throws when printing a layout filter with no layouts", async () => {
    await expect(
        printAgentWebTaskFilters(storage, [
            {type: "Layout", operation: {type: "OneOf", layouts: []}},
        ]),
    ).rejects.toThrow("Can\u2019t print a task layout filter with no layouts");
});

test("throws when printing a collection filter without a stored link", async () => {
    await expect(
        printAgentWebTaskFilters(storage, [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collections: [{id: generateId<TaskCollectionId>()}],
                },
            },
        ]),
    ).rejects.toThrow("Missing stored link pathname for task filter reference");
});

test("throws when printing a negative date duration", async () => {
    await expect(
        printAgentWebTaskFilters(storage, [
            {
                type: "Due",
                operation: {
                    type: "GreaterThan",
                    date: {type: "RelativeAfterToday", duration: {type: "Days", days: -3}},
                },
            },
        ]),
    ).rejects.toThrow("Can\u2019t print the task filter date duration count \u201c-3\u201d");
});

test("parses search params through agent web path normalization", async () => {
    const {searchParams} = normalizeAgentWebPath("/task-collection/roadmap?due[before]=today+3d");

    expect(await parseAgentWebTaskFilters(storage, searchParams)).toEqual([
        {
            type: "Due",
            operation: {
                type: "LessThan",
                date: {type: "RelativeAfterToday", duration: {type: "Days", days: 3}},
            },
        },
    ]);
});

test("parses a percent-encoded plus in a relative date", async () => {
    expect(
        await parseAgentWebTaskFilters(storage, new URLSearchParams("due[after]=today%2B2w")),
    ).toEqual([
        {
            type: "Due",
            operation: {
                type: "GreaterThan",
                date: {type: "RelativeAfterToday", duration: {type: "Weeks", weeks: 2}},
            },
        },
    ]);
});

test("parses percent-encoded square brackets in a filter key", async () => {
    expect(
        await parseAgentWebTaskFilters(storage, new URLSearchParams("due%5Bbefore%5D=2026-07-12")),
    ).toEqual([
        {
            type: "Due",
            operation: {type: "LessThan", date: {type: "Absolute", date: "2026-07-12"}},
        },
    ]);
});

test("parses a full account path in an assignee filter", async () => {
    const accountId = await createAccountLinkForTest("John Doe");

    expect(
        await parseAgentWebTaskFilters(storage, new URLSearchParams("assignee=/human/john-doe")),
    ).toEqual([
        {
            type: "Assignee",
            operation: {type: "OneOf", accounts: [{type: "Account", account: {id: accountId}}]},
        },
    ]);
});

test("parses a full collection path in a collection filter", async () => {
    const collectionId = await createTaskCollectionLinkForTest("Roadmap");

    expect(
        await parseAgentWebTaskFilters(
            storage,
            new URLSearchParams("collection=/task-collection/roadmap"),
        ),
    ).toEqual([
        {
            type: "Collections",
            operation: {type: "IncludesOneOf", collections: [{id: collectionId}]},
        },
    ]);
});

test("parses repeated identical values into one deduped filter", async () => {
    expect(
        await parseAgentWebTaskFilters(storage, new URLSearchParams("status=open&status=open")),
    ).toEqual([
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
    ]);
});

test("parses an empty value in a list filter run as no value", async () => {
    expect(
        await parseAgentWebTaskFilters(storage, new URLSearchParams("status=&status=open")),
    ).toEqual([
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
    ]);
});

test("parses negated and positive filters in order", async () => {
    expect(
        await parseAgentWebTaskFilters(
            storage,
            new URLSearchParams("status[not]=closed&status=open"),
        ),
    ).toEqual([
        {type: "Status", operation: {type: "NoneOf", statuses: [{type: "Closed"}]}},
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
    ]);
});

test("parses a break param with a value as a no-op", async () => {
    expect(
        await parseAgentWebTaskFilters(storage, new URLSearchParams("break=anything&status=open")),
    ).toEqual([
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
    ]);
});

test("parses an old account pathname after the account was renamed", async () => {
    const accountId = generateId<AccountId>();

    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Account",
        id: accountId,
        title: "John Doe",
        shortName: "John",
    });

    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Account",
        id: accountId,
        title: "Johnny Doe",
        shortName: "Johnny",
    });

    expect(
        await parseAgentWebTaskFilters(storage, new URLSearchParams("assignee=john-doe")),
    ).toEqual([
        {
            type: "Assignee",
            operation: {type: "OneOf", accounts: [{type: "Account", account: {id: accountId}}]},
        },
    ]);
});

test("throws when parsing an unknown task filter key", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("stauts=open")),
    ).rejects.toThrow("Unknown task filter");
});

test("throws when parsing an unknown task filter operator", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("status[all]=open")),
    ).rejects.toThrow("Unknown task filter operator");
});

test("throws when parsing a date filter without an operator", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("created=2026-01-01")),
    ).rejects.toThrow("Unknown task filter operator");
});

test("throws when parsing an unknown date filter operator", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("due[since]=today")),
    ).rejects.toThrow("Unknown task filter operator");
});

test("throws when parsing an empty layout filter value", async () => {
    await expect(parseAgentWebTaskFilters(storage, new URLSearchParams("layout="))).rejects.toThrow(
        "Empty task layout filter",
    );
});

test("throws when parsing an empty due filter value", async () => {
    await expect(parseAgentWebTaskFilters(storage, new URLSearchParams("due="))).rejects.toThrow(
        "Unexpected due task filter value",
    );
});

test("throws when parsing an unknown status", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("status=done")),
    ).rejects.toThrow("Unexpected task status filter value");
});

test("throws when parsing an uppercase status", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("status=Open")),
    ).rejects.toThrow("Unexpected task status filter value");
});

test("throws when parsing an unknown priority", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("priority=critical")),
    ).rejects.toThrow("Unexpected task priority filter value");
});

test("throws when parsing an unknown layout", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("layout=board")),
    ).rejects.toThrow("Unexpected task layout filter value");
});

test("throws when parsing an account which was never linked", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("assignee=nobody")),
    ).rejects.toThrow("Unknown account in task filter");
});

test("throws when parsing an account path which was never linked", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("assignee=/human/nobody")),
    ).rejects.toThrow("Unknown account in task filter");
});

test("throws when parsing a non-account path as an assignee", async () => {
    await createTaskCollectionLinkForTest("Roadmap");

    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("assignee=/task-collection/roadmap")),
    ).rejects.toThrow("Unknown account in task filter");
});

test("throws when parsing a creator filter with no creator", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("creator=none")),
    ).rejects.toThrow("Unexpected creator task filter value");
});

test("throws when parsing a collection which was never linked", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("collection=nothing")),
    ).rejects.toThrow("Unknown task collection in task filter");
});

test("throws when parsing a negated no collections value", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("collection[not]=none")),
    ).rejects.toThrow("Unknown task collection in task filter");
});

test("throws when parsing a due date without an operator", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("due=2026-07-12")),
    ).rejects.toThrow("Unexpected due task filter value");
});

test("throws when parsing an unknown due value", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("due=tomorrow")),
    ).rejects.toThrow("Unexpected due task filter value");
});

test("throws when parsing an unknown date", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("created[after]=someday")),
    ).rejects.toThrow("Unexpected task filter date");
});

test("throws when parsing an impossible calendar date", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("due[before]=2026-13-45")),
    ).rejects.toThrow("Unexpected task filter date");
});

test("throws when parsing an unknown date duration unit", async () => {
    await expect(
        parseAgentWebTaskFilters(storage, new URLSearchParams("due[before]=today+3months")),
    ).rejects.toThrow("Unexpected task filter date");
});
