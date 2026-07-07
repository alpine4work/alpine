import {
    parseAgentWebTaskFilters,
    printAgentWebTaskFilters,
} from "~/server/agents/web/agent_web_task_filters.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {normalizeApiTaskFilters} from "~/server/agents/web/normalize_api_task_filters.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
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

