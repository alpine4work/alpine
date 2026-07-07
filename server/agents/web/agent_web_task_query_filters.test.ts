import {
    parseAgentWebTaskQueryFilters,
    printAgentWebTaskQueryFilters,
} from "~/server/agents/web/agent_web_task_query_filters.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {normalizeApiTaskQueryFilters} from "~/shared/api/content/normalize_api_task_query_filters.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiAccountResponse,
    ApiAccountWithoutSpaceResponse,
    ApiTaskCollectionPreviewResponse,
    ApiTaskQueryFilter,
    ApiTaskQueryFilterResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";

const storage = createAgentWebSessionStorageForTest(generateId<SpaceId>());

/**
 * Asserts that `filters` print to exactly `searchParamsString` and that parsing
 * `searchParamsString` returns exactly the normalized filters. The printed string
 * is inline in each test so the aesthetics of the format are easy to review.
 *
 * Parsed filters are compared without hydrated response data (like account names)
 * since the printed search params only reference accounts and task collections by
 * the names in their pathnames.
 */
async function expectTaskQueryFilterFormat(
    filters: ReadonlyArray<ApiTaskQueryFilterResponse>,
    searchParamsString: string,
): Promise<void> {
    expect({
        printed: await printAgentWebTaskQueryFilters(storage, filters),
        parsed: await parseAgentWebTaskQueryFilters(storage, new URLSearchParams(searchParamsString)),
    }).toEqual({
        printed: searchParamsString,
        parsed: intoApiTaskQueryFiltersWithoutResponseData(normalizeApiTaskQueryFilters(filters)),
    });
}

/**
 * Converts task filter responses into plain task filters by dropping hydrated
 * response data like account and task collection names.
 */
function intoApiTaskQueryFiltersWithoutResponseData(
    filters: ReadonlyArray<ApiTaskQueryFilterResponse>,
): Array<ApiTaskQueryFilter> {
    return filters.map((filter): ApiTaskQueryFilter => {
        switch (filter.type) {
            case "Collections": {
                const {operation} = filter;
                if (operation.type === "IsEmpty") return {type: "Collections", operation};

                return {
                    type: "Collections",
                    operation: {
                        type: operation.type,
                        collections: operation.collections.map(collection => ({
                            id: collection.id,
                        })),
                    },
                };
            }
            case "Assignee":
            case "Assigner": {
                return {
                    type: filter.type,
                    operation: {
                        type: filter.operation.type,
                        accounts: filter.operation.accounts.map(account =>
                            account.type === "Account"
                                ? {type: "Account", account: {id: account.account.id}}
                                : account,
                        ),
                    },
                };
            }
            case "Creator": {
                return {
                    type: "Creator",
                    operation: {
                        type: filter.operation.type,
                        accounts: filter.operation.accounts.map(account =>
                            account.type === "Account"
                                ? {type: "Account", account: {id: account.account.id}}
                                : account,
                        ),
                    },
                };
            }
            default:
                return filter;
        }
    });
}

async function createAccountForTest(
    name: string,
    {bot = false}: {bot?: boolean} = {},
): Promise<ApiAccountResponse> {
    const account: ApiAccountResponse = {
        id: generateId<AccountId>(),
        name,
        shortName: name.split(" ")[0]!,
        bot: bot ? {id: generateId<BotId>()} : undefined,
        space: {role: "Member", addedTime: serializeDateString(new Date())},
    };

    // `printAgentWebTaskQueryFilters()` creates links on demand but tests create them ahead
    // of time so pathname dedupe numbers are assigned deterministically.
    await createAgentWebPageStoredLinkPathname(storage, intoApiAccountReference(account));

    return account;
}

async function createTaskCollectionForTest(
    name: string,
): Promise<ApiTaskCollectionPreviewResponse> {
    const collection: ApiTaskCollectionPreviewResponse = {
        id: generateId<TaskCollectionId>(),
        name,
    };

    await createAgentWebPageStoredLinkPathname(storage, {
        type: "TaskCollection",
        id: collection.id,
        title: collection.name,
    });

    return collection;
}

function printDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    return displayMessage.map(segment => segment.text).join("");
}

function getDisplayMessage(error: unknown): ErrorDisplayMessage {
    if (error instanceof ErrorBase && error.displayMessage) {
        return error.displayMessage;
    }

    if (error instanceof AggregateError) {
        for (const childError of error.errors) {
            if (childError instanceof ErrorBase && childError.displayMessage) {
                return childError.displayMessage;
            }
        }
    }

    throw error;
}

/**
 * Asserts that parsing `searchParamsString` throws an error with exactly the
 * `expected` display message. The full message is inline in each test so the
 * errors an agent would see are easy to review.
 */
async function expectParseTaskQueryFiltersDisplayMessage(
    searchParamsString: string,
    expected: string,
): Promise<void> {
    let error: unknown;

    try {
        await parseAgentWebTaskQueryFilters(storage, new URLSearchParams(searchParamsString));
    } catch (actualError) {
        error = actualError;
    }

    if (error === undefined) throw new InternalError("Expected task filter parsing to throw");

    expect(printDisplayMessage(getDisplayMessage(error))).toEqual(expected);
}

test("prints no search params for no filters", async () => {
    await expectTaskQueryFilterFormat([], "");
});

test("prints an open status filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Status", operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]}}],
        "status=open",
    );
});

test("prints an active status filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Status", operation: {type: "OneOf", statuses: [{type: "Open", isActive: true}]}}],
        "status=open-active",
    );
});

test("prints a closed status filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Status", operation: {type: "OneOf", statuses: [{type: "Closed"}]}}],
        "status=closed",
    );
});

test("prints a status filter with multiple statuses", async () => {
    await expectTaskQueryFilterFormat(
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
        "status=open,open-active",
    );
});

test("prints a status filter deduping repeated statuses", async () => {
    await expectTaskQueryFilterFormat(
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
        "status=open,closed",
    );
});

test("prints a status filter with no statuses", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Status", operation: {type: "OneOf", statuses: []}}],
        "status=",
    );
});

test("prints a negated status filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Status", operation: {type: "NoneOf", statuses: [{type: "Closed"}]}}],
        "status[not]=closed",
    );
});

test("prints a negated status filter with no statuses", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Status", operation: {type: "NoneOf", statuses: []}}],
        "status[not]=",
    );
});

test("prints a negated status filter with multiple statuses", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Status",
                operation: {
                    type: "NoneOf",
                    statuses: [{type: "Open", isActive: true}, {type: "Closed"}],
                },
            },
        ],
        "status[not]=open-active,closed",
    );
});

test("prints positive and negated status filters together", async () => {
    await expectTaskQueryFilterFormat(
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

test("prints two status filters of the same kind as separate params", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Status",
                operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
            },
            {type: "Status", operation: {type: "OneOf", statuses: [{type: "Closed"}]}},
        ],
        "status=open&status=closed",
    );
});

test("prints two empty status filters as separate params", async () => {
    await expectTaskQueryFilterFormat(
        [
            {type: "Status", operation: {type: "OneOf", statuses: []}},
            {type: "Status", operation: {type: "OneOf", statuses: []}},
        ],
        "status=&status=",
    );
});

test("prints a high priority filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Priority", operation: {type: "OneOf", priorities: [{type: "High"}]}}],
        "priority=high",
    );
});

test("prints a priority filter with every priority", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: [{type: "Low"}, {type: "Medium"}, {type: "High"}, {type: "Urgent"}],
                },
            },
        ],
        "priority=low,medium,high,urgent",
    );
});

test("prints a missing priority filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Priority", operation: {type: "OneOf", priorities: [null]}}],
        "priority=none",
    );
});

test("prints a priority filter mixing a priority and no priority", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Priority", operation: {type: "OneOf", priorities: [{type: "High"}, null]}}],
        "priority=high,none",
    );
});

test("prints a priority filter deduping repeated priorities", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Priority",
                operation: {
                    type: "OneOf",
                    priorities: [{type: "High"}, {type: "High"}, null, null],
                },
            },
        ],
        "priority=high,none",
    );
});

test("prints a priority filter with no priorities", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Priority", operation: {type: "OneOf", priorities: []}}],
        "priority=",
    );
});

test("prints a negated priority filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Priority", operation: {type: "NoneOf", priorities: [{type: "Urgent"}]}}],
        "priority[not]=urgent",
    );
});

test("prints a negated missing priority filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Priority", operation: {type: "NoneOf", priorities: [null]}}],
        "priority[not]=none",
    );
});

test("prints a layout filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Layout", operation: {type: "OneOf", layouts: [{type: "Project"}]}}],
        "layout=project",
    );
});

test("prints a negated layout filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Layout", operation: {type: "NoneOf", layouts: [{type: "Project"}]}}],
        "layout[not]=project",
    );
});

test("prints a title filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "launch"}}],
        "title=launch",
    );
});

test("prints a title filter with spaces", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "fix the bug"}}],
        "title=fix+the+bug",
    );
});

test("prints a title filter with no text", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: ""}}],
        "title=",
    );
});

test("prints a negated title filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Excludes", titleQuery: "draft"}}],
        "title[not]=draft",
    );
});

test("prints multiple title filters", async () => {
    await expectTaskQueryFilterFormat(
        [
            {type: "Title", operation: {type: "Includes", titleQuery: "launch"}},
            {type: "Title", operation: {type: "Excludes", titleQuery: "draft"}},
        ],
        "title=launch&title[not]=draft",
    );
});

test("prints two title filters of the same kind as separate params", async () => {
    await expectTaskQueryFilterFormat(
        [
            {type: "Title", operation: {type: "Includes", titleQuery: "alpha"}},
            {type: "Title", operation: {type: "Includes", titleQuery: "beta"}},
        ],
        "title=alpha&title=beta",
    );
});

test("prints a title filter escaping URL search param characters", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "50% & more #1 + tax"}}],
        "title=50%25+%26+more+%231+%2B+tax",
    );
});

test("prints a title filter percent encoding unicode", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "café ☕"}}],
        "title=caf%C3%A9+%E2%98%95",
    );
});

test("prints a title filter percent encoding WHATWG URL query characters", async () => {
    await expectTaskQueryFilterFormat(
        // eslint-disable-next-line cyberworlds/string-quotes -- Testing the literal straight quote escape.
        [{type: "Title", operation: {type: "Includes", titleQuery: '"a" < b > c'}}],
        "title=%22a%22+%3C+b+%3E+c",
    );
});

test("prints a title filter replacing lone surrogates", async () => {
    // Lone surrogates can't round trip: they aren't encodable as UTF-8 so both this
    // format and the binary task filter serialization replace them with U+FFFD.
    expect(
        await printAgentWebTaskQueryFilters(storage, [
            {type: "Title", operation: {type: "Includes", titleQuery: "a\ud800b"}},
        ]),
    ).toBe("title=a%EF%BF%BDb");
});

test("prints a title filter without escaping equals signs", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "a=b"}}],
        "title=a=b",
    );
});

test("prints a title filter with a literal comma", async () => {
    // Title filters hold text instead of a list of values so commas stay literal.
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "first, second"}}],
        "title=first,+second",
    );
});

test("prints a title filter escaping control characters", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "a\tb"}}],
        "title=a%09b",
    );
});

test("prints a title filter for text which looks like a reserved value", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Title", operation: {type: "Includes", titleQuery: "none"}}],
        "title=none",
    );
});

test("prints an assignee filter with an account", async () => {
    const account = await createAccountForTest("John Doe");

    await expectTaskQueryFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: [{type: "Account", account}]}}],
        "assignee=john-doe",
    );
});

test("prints an assignee filter with a bot account", async () => {
    const account = await createAccountForTest("Melvin", {bot: true});

    await expectTaskQueryFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: [{type: "Account", account}]}}],
        "assignee=melvin",
    );
});

test("prints an assignee filter creating a link for an unseen account", async () => {
    const account: ApiAccountResponse = {
        id: generateId<AccountId>(),
        name: "Anthony Mose",
        shortName: "Anthony",
        space: {role: "Member", addedTime: serializeDateString(new Date())},
    };

    // `printAgentWebTaskQueryFilters()` creates links for referenced accounts on demand
    // using the hydrated response data, no link has to exist ahead of time.
    await expectTaskQueryFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: [{type: "Account", account}]}}],
        "assignee=anthony-mose",
    );
});

test("prints unambiguous assignee filters for a human and a bot with the same name", async () => {
    const humanAccount = await createAccountForTest("Caleb");
    const botAccount = await createAccountForTest("Caleb", {bot: true});

    await expectTaskQueryFilterFormat(
        [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", account: humanAccount}],
                },
            },
            {
                type: "Assigner",
                operation: {type: "OneOf", accounts: [{type: "Account", account: botAccount}]},
            },
        ],
        "assignee=caleb&assigner=caleb-2",
    );
});

test("prints a full account path for an account named like a reserved value", async () => {
    const account = await createAccountForTest("Me");

    await expectTaskQueryFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: [{type: "Account", account}]}}],
        "assignee=/human/me",
    );
});

test("prints an assignee filter with the current account", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}}],
        "assignee=me",
    );
});

test("prints an unassigned tasks filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: [{type: "MissingAccount"}]}}],
        "assignee=none",
    );
});

test("prints an assignee filter with multiple accounts", async () => {
    const account = await createAccountForTest("John Doe");

    await expectTaskQueryFilterFormat(
        [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [{type: "Account", account}, {type: "CurrentAccount"}],
                },
            },
        ],
        "assignee=john-doe,me",
    );
});

test("prints an assignee filter deduping repeated accounts", async () => {
    const account = await createAccountForTest("John Doe");

    await expectTaskQueryFilterFormat(
        [
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", account},
                        {type: "Account", account},
                        {type: "CurrentAccount"},
                        {type: "CurrentAccount"},
                    ],
                },
            },
        ],
        "assignee=john-doe,me",
    );
});

test("prints an assignee filter with no accounts", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Assignee", operation: {type: "OneOf", accounts: []}}],
        "assignee=",
    );
});

test("prints a negated assignee filter", async () => {
    const account = await createAccountForTest("John Doe");

    await expectTaskQueryFilterFormat(
        [{type: "Assignee", operation: {type: "NoneOf", accounts: [{type: "Account", account}]}}],
        "assignee[not]=john-doe",
    );
});

test("prints an assigned tasks filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Assignee", operation: {type: "NoneOf", accounts: [{type: "MissingAccount"}]}}],
        "assignee[not]=none",
    );
});

test("prints a creator filter with an account", async () => {
    const account = await createAccountForTest("John Doe");

    await expectTaskQueryFilterFormat(
        [{type: "Creator", operation: {type: "OneOf", accounts: [{type: "Account", account}]}}],
        "creator=john-doe",
    );
});

test("prints a negated creator filter with the current account", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Creator", operation: {type: "NoneOf", accounts: [{type: "CurrentAccount"}]}}],
        "creator[not]=me",
    );
});

test("prints an assigner filter with the current account", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Assigner", operation: {type: "OneOf", accounts: [{type: "CurrentAccount"}]}}],
        "assigner=me",
    );
});

test("prints a collection filter", async () => {
    const collection = await createTaskCollectionForTest("Roadmap");

    await expectTaskQueryFilterFormat(
        [{type: "Collections", operation: {type: "IncludesOneOf", collections: [collection]}}],
        "collection=roadmap",
    );
});

test("prints a collection filter creating a link for an unseen collection", async () => {
    // `printAgentWebTaskQueryFilters()` creates links for referenced task collections on
    // demand using the hydrated response data, no link has to exist ahead of time.
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Collections",
                operation: {
                    type: "IncludesOneOf",
                    collections: [{id: generateId<TaskCollectionId>(), name: "Unseen Collection"}],
                },
            },
        ],
        "collection=unseen-collection",
    );
});

test("prints a collection filter with multiple collections", async () => {
    const engineering = await createTaskCollectionForTest("Engineering");
    const design = await createTaskCollectionForTest("Design");

    await expectTaskQueryFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [engineering, design]},
            },
        ],
        "collection=engineering,design",
    );
});

test("prints a collection filter deduping repeated collections", async () => {
    const collection = await createTaskCollectionForTest("Roadmap");

    await expectTaskQueryFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [collection, collection]},
            },
        ],
        "collection=roadmap",
    );
});

test("prints a collection filter with no collections", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Collections", operation: {type: "IncludesOneOf", collections: []}}],
        "collection=",
    );
});

test("prints a collection filter requiring every collection", async () => {
    const engineering = await createTaskCollectionForTest("Engineering");
    const design = await createTaskCollectionForTest("Design");

    await expectTaskQueryFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesAllOf", collections: [engineering, design]},
            },
        ],
        "collection[all]=engineering,design",
    );
});

test("prints a negated collection filter", async () => {
    const collection = await createTaskCollectionForTest("Archive");

    await expectTaskQueryFilterFormat(
        [{type: "Collections", operation: {type: "ExcludesAllOf", collections: [collection]}}],
        "collection[not]=archive",
    );
});

test("prints a tasks in no collections filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Collections", operation: {type: "IsEmpty"}}],
        "collection=none",
    );
});

test("prints a full collection path for a collection named like a reserved value", async () => {
    const collection = await createTaskCollectionForTest("None");

    await expectTaskQueryFilterFormat(
        [{type: "Collections", operation: {type: "IncludesOneOf", collections: [collection]}}],
        "collection=/task-collection/none",
    );
});

test("prints a collection filter next to a tasks in no collections filter", async () => {
    const collection = await createTaskCollectionForTest("Roadmap");

    await expectTaskQueryFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [collection]},
            },
            {type: "Collections", operation: {type: "IsEmpty"}},
        ],
        "collection=roadmap&collection=none",
    );
});

test("prints interleaved collection filters", async () => {
    const engineering = await createTaskCollectionForTest("Engineering");
    const design = await createTaskCollectionForTest("Design");
    const roadmap = await createTaskCollectionForTest("Roadmap");
    const archive = await createTaskCollectionForTest("Archive");

    await expectTaskQueryFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [engineering]},
            },
            {type: "Collections", operation: {type: "IncludesAllOf", collections: [design]}},
            {type: "Collections", operation: {type: "IncludesOneOf", collections: [roadmap]}},
            {type: "Collections", operation: {type: "IncludesAllOf", collections: [archive]}},
        ],
        // `collection=engineering` and `collection=roadmap` are ANDed like every other
        // pair of params. Tasks in either collection is one param: `collection=a,b`.
        "collection=engineering&collection[all]=design&collection=roadmap&collection[all]=archive",
    );
});

test("prints adjacent collection filters of the same kind as separate params", async () => {
    const engineering = await createTaskCollectionForTest("Engineering");
    const design = await createTaskCollectionForTest("Design");

    await expectTaskQueryFilterFormat(
        [
            {
                type: "Collections",
                operation: {type: "IncludesOneOf", collections: [engineering]},
            },
            {type: "Collections", operation: {type: "IncludesOneOf", collections: [design]}},
        ],
        "collection=engineering&collection=design",
    );
});

test("prints an overdue filter", async () => {
    await expectTaskQueryFilterFormat([{type: "Due", operation: {type: "Overdue"}}], "due=overdue");
});

test("prints a tasks with no due date filter", async () => {
    await expectTaskQueryFilterFormat([{type: "Due", operation: {type: "IsEmpty"}}], "due=none");
});

test("prints a due before an absolute date filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Due",
                operation: {type: "LessThan", time: {type: "AbsoluteDate", date: "2026-07-12"}},
            },
        ],
        "due[before]=2026-07-12",
    );
});

test("prints a due after an absolute date filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Due",
                operation: {type: "GreaterThan", time: {type: "AbsoluteDate", date: "2026-07-12"}},
            },
        ],
        "due[after]=2026-07-12",
    );
});

test("prints a due before today filter", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Due", operation: {type: "LessThan", time: {type: "RelativeToday"}}}],
        "due[before]=today",
    );
});

test("prints a due after a relative days filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Due",
                operation: {
                    type: "GreaterThan",
                    time: {type: "RelativeAfterToday", duration: {type: "Days", days: 3}},
                },
            },
        ],
        "due[after]=today+3d",
    );
});

test("prints a due before a relative weeks filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Due",
                operation: {
                    type: "LessThan",
                    time: {type: "RelativeAfterToday", duration: {type: "Weeks", weeks: 2}},
                },
            },
        ],
        "due[before]=today+2w",
    );
});

test("prints a due after a relative months in the past filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Due",
                operation: {
                    type: "GreaterThan",
                    time: {type: "RelativeBeforeToday", duration: {type: "Months", months: 6}},
                },
            },
        ],
        "due[after]=today-6mo",
    );
});

test("prints a due before a relative years in the past filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Due",
                operation: {
                    type: "LessThan",
                    time: {type: "RelativeBeforeToday", duration: {type: "Years", years: 1}},
                },
            },
        ],
        "due[before]=today-1y",
    );
});

test("prints a due date range with two filters", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "Due",
                operation: {type: "GreaterThan", time: {type: "AbsoluteDate", date: "2026-07-01"}},
            },
            {
                type: "Due",
                operation: {type: "LessThan", time: {type: "AbsoluteDate", date: "2026-08-01"}},
            },
        ],
        "due[after]=2026-07-01&due[before]=2026-08-01",
    );
});

test("prints a due date filter whose date hasn\u2019t been chosen yet", async () => {
    await expectTaskQueryFilterFormat(
        [{type: "Due", operation: {type: "LessThan", time: {type: "AbsoluteDate", date: null}}}],
        "due[before]=",
    );
});

test("prints a created date filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "CreatedTime",
                operation: {type: "GreaterThan", time: {type: "AbsoluteDate", date: "2026-01-01"}},
            },
        ],
        "created[after]=2026-01-01",
    );
});

test("prints an assigned date filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "AssignedTime",
                operation: {
                    type: "LessThan",
                    time: {type: "RelativeBeforeToday", duration: {type: "Weeks", weeks: 1}},
                },
            },
        ],
        "assigned[before]=today-1w",
    );
});

test("prints a closed date filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "ClosedTime",
                operation: {
                    type: "GreaterThan",
                    time: {type: "RelativeBeforeToday", duration: {type: "Days", days: 3}},
                },
            },
        ],
        "closed[after]=today-3d",
    );
});

test("prints an activated date filter", async () => {
    await expectTaskQueryFilterFormat(
        [
            {
                type: "ActivatedTime",
                operation: {type: "LessThan", time: {type: "AbsoluteDate", date: "2026-06-30"}},
            },
        ],
        "activated[before]=2026-06-30",
    );
});

test("prints a combined set of filters", async () => {
    await expectTaskQueryFilterFormat(
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
                    time: {type: "RelativeAfterToday", duration: {type: "Weeks", weeks: 1}},
                },
            },
        ],
        "status=open&priority=high,urgent&due[before]=today+1w",
    );
});

test("prints status filters separated by another filter", async () => {
    await expectTaskQueryFilterFormat(
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
        normalizeApiTaskQueryFilters([
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
    const account: ApiAccountWithoutSpaceResponse = {
        id: generateId<AccountId>(),
        name: "John Doe",
        shortName: "John",
    };

    expect(
        normalizeApiTaskQueryFilters([
            {
                type: "Assignee",
                operation: {
                    type: "OneOf",
                    accounts: [
                        {type: "Account", account},
                        {type: "MissingAccount"},
                        {type: "Account", account},
                    ],
                },
            },
        ]),
    ).toEqual([
        {
            type: "Assignee",
            operation: {
                type: "OneOf",
                accounts: [{type: "Account", account}, {type: "MissingAccount"}],
            },
        },
    ]);
});

test("normalization leaves distinct filters unchanged", () => {
    const filters: ReadonlyArray<ApiTaskQueryFilterResponse> = [
        {type: "Title", operation: {type: "Includes", titleQuery: "launch"}},
        {type: "Due", operation: {type: "Overdue"}},
        {type: "Due", operation: {type: "LessThan", time: {type: "AbsoluteDate", date: null}}},
        {
            type: "Priority",
            operation: {type: "OneOf", priorities: [{type: "High"}, null]},
        },
    ];

    expect(normalizeApiTaskQueryFilters(filters)).toEqual(filters);
});

test("parses search params through agent web path normalization", async () => {
    const {searchParams} = normalizeAgentWebPath("/task-collection/roadmap?due[before]=today+3d");

    expect(await parseAgentWebTaskQueryFilters(storage, searchParams)).toEqual([
        {
            type: "Due",
            operation: {
                type: "LessThan",
                time: {type: "RelativeAfterToday", duration: {type: "Days", days: 3}},
            },
        },
    ]);
});

test("parses a percent-encoded plus in a relative date", async () => {
    expect(
        await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("due[after]=today%2B2w")),
    ).toEqual([
        {
            type: "Due",
            operation: {
                type: "GreaterThan",
                time: {type: "RelativeAfterToday", duration: {type: "Weeks", weeks: 2}},
            },
        },
    ]);
});

test("parses percent-encoded square brackets in a filter key", async () => {
    expect(
        await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("due%5Bbefore%5D=2026-07-12")),
    ).toEqual([
        {
            type: "Due",
            operation: {type: "LessThan", time: {type: "AbsoluteDate", date: "2026-07-12"}},
        },
    ]);
});

test("parses a full account path in an assignee filter", async () => {
    const account = await createAccountForTest("John Doe");

    expect(
        await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("assignee=/human/john-doe")),
    ).toEqual([
        {
            type: "Assignee",
            operation: {type: "OneOf", accounts: [{type: "Account", account: {id: account.id}}]},
        },
    ]);
});

test("parses a full collection path in a collection filter", async () => {
    const collection = await createTaskCollectionForTest("Roadmap");

    expect(
        await parseAgentWebTaskQueryFilters(
            storage,
            new URLSearchParams("collection=/task-collection/roadmap"),
        ),
    ).toEqual([
        {
            type: "Collections",
            operation: {type: "IncludesOneOf", collections: [{id: collection.id}]},
        },
    ]);
});

test("parses repeated identical values into one deduped filter", async () => {
    expect(
        await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("status=open,open")),
    ).toEqual([
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
    ]);
});

test("parses empty comma segments as no values", async () => {
    expect(await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("status=,open"))).toEqual([
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
    ]);
});

test("parses repeated same-key params as separate filters", async () => {
    expect(
        await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("status=open&status=open")),
    ).toEqual([
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
    ]);
});

test("parses negated and positive filters in order", async () => {
    expect(
        await parseAgentWebTaskQueryFilters(
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

test("parses each bare due param as its own filter", async () => {
    expect(
        await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("due=overdue&due=none")),
    ).toEqual([
        {type: "Due", operation: {type: "Overdue"}},
        {type: "Due", operation: {type: "IsEmpty"}},
    ]);
});

test("ignores unknown search params", async () => {
    expect(await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("stauts=open"))).toEqual([]);
});

test("ignores unknown search params with values", async () => {
    expect(
        await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("cursor=anything&status=open")),
    ).toEqual([
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
    ]);
});

test("ignores unknown search params between filter params", async () => {
    expect(
        await parseAgentWebTaskQueryFilters(
            storage,
            new URLSearchParams("status=open&unknown=x&status=closed"),
        ),
    ).toEqual([
        {
            type: "Status",
            operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
        },
        {type: "Status", operation: {type: "OneOf", statuses: [{type: "Closed"}]}},
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
        await parseAgentWebTaskQueryFilters(storage, new URLSearchParams("assignee=john-doe")),
    ).toEqual([
        {
            type: "Assignee",
            operation: {type: "OneOf", accounts: [{type: "Account", account: {id: accountId}}]},
        },
    ]);
});

test("throws when parsing an unknown task filter operator", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "status[all]=open",
        "Unknown task filter `status[all]=...`. Try again with `status` or `status[not]`.",
    );
});

test("throws when parsing a date filter without an operator", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "created=2026-01-01",
        "Unknown task filter `created=...`. Try again with `created[before]` or " +
            "`created[after]`.",
    );
});

test("throws when parsing an unknown date filter operator", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "due[since]=today",
        "Unknown task filter `due[since]=...`. Try again with `due`, `due[before]`, or " +
            "`due[after]`.",
    );
});

test("throws when parsing an empty layout filter value", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "layout=",
        "Unexpected empty value in the `layout` task filter. Try again with `project` " +
            "(e.g. `layout=project`).",
    );
});

test("throws when parsing an empty due filter value", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "due=",
        "Unexpected value `` for the `due` task filter in the URL search params. Try again " +
            "with `due=overdue`, `due=none` for tasks with no due date, or a date operator " +
            "(e.g. `due[before]=2026-07-12` or `due[after]=today`).",
    );
});

test("throws when parsing an unknown status", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "status=done",
        "Unexpected task status filter `status=done`. Try again with `open`, " +
            "`open-active`, or `closed` (e.g. `status=open` or `status[not]=closed`).",
    );
});

test("throws when parsing an uppercase status", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "status=Open",
        "Unexpected task status filter `status=Open`. Try again with `open`, " +
            "`open-active`, or `closed` (e.g. `status=open` or `status[not]=closed`).",
    );
});

test("throws when parsing an unknown priority", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "priority=critical",
        "Unexpected task priority filter `priority=critical`. Try again with `low`, " +
            "`medium`, `high`, or `none` (e.g. `priority=high` or `priority[not]=none`).",
    );
});

test("throws when parsing an unknown layout", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "layout=board",
        "Unexpected task layout filter `layout=board`. Try again with `project` (e.g. " +
            "`layout=project`).",
    );
});

test("throws when parsing an account which was never linked", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "assignee=nobody",
        "Nothing found for `nobody` in the `assignee` task filter. You may only filter by " +
            "those you\u2019ve already seen a link for, using the name from their path (e.g. " +
            "`assignee=john-doe` for `/human/john-doe`), `me` for yourself (e.g. " +
            "`assignee=me`), or `none` for tasks with no assignee (e.g. `assignee=none`). " +
            "Try calling the `search` tool to find people.",
    );
});

test("throws when parsing an account path which was never linked", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "assignee=/human/nobody",
        "Nothing found for `/human/nobody` in the `assignee` task filter. You may only " +
            "filter by those you\u2019ve already seen a link for, using the name from their " +
            "path (e.g. `assignee=john-doe` for `/human/john-doe`), `me` for yourself " +
            "(e.g. `assignee=me`), or `none` for tasks with no assignee (e.g. " +
            "`assignee=none`). Try calling the `search` tool to find people.",
    );
});

test("throws when parsing a non-account path as an assignee", async () => {
    await createTaskCollectionForTest("Roadmap");

    await expectParseTaskQueryFiltersDisplayMessage(
        "assignee=/task-collection/roadmap",
        "Nothing found for `/task-collection/roadmap` in the `assignee` task filter. You " +
            "may only filter by those you\u2019ve already seen a link for, using the name " +
            "from their path (e.g. `assignee=john-doe` for `/human/john-doe`), `me` for " +
            "yourself (e.g. `assignee=me`), or `none` for tasks with no assignee (e.g. " +
            "`assignee=none`). Try calling the `search` tool to find people.",
    );
});

test("throws when parsing a creator filter with no creator", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "creator=none",
        "The task filter `creator=none` isn\u2019t supported since every task has a creator. " +
            "Try again with the name of an account (e.g. `creator=john-doe`) or `me` for " +
            "yourself (e.g. `creator=me`).",
    );
});

test("throws when parsing a creator which was never linked", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "creator=nobody",
        "Nothing found for `nobody` in the `creator` task filter. You may only filter by " +
            "those you\u2019ve already seen a link for, using the name from their path (e.g. " +
            "`creator=john-doe` for `/human/john-doe`) or `me` for yourself (e.g. " +
            "`creator=me`). Try calling the `search` tool to find people.",
    );
});

test("throws when parsing a collection which was never linked", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "collection=nothing",
        "Nothing found for `nothing` in the `collection` task filter. You may only filter " +
            "by task collections you\u2019ve already seen a link for, using the name from the " +
            "collection\u2019s path (e.g. `collection=roadmap` for " +
            "`/task-collection/roadmap`) or `none` for tasks in no collections (e.g. " +
            "`collection=none`). Try calling the `search` tool to find task collections.",
    );
});

test("throws when parsing a no collections value combined with collections", async () => {
    await createTaskCollectionForTest("Roadmap");

    await expectParseTaskQueryFiltersDisplayMessage(
        "collection=roadmap,none",
        "`none` can\u2019t be combined with other collections in the `collection` task filter " +
            "since a task with no collections can\u2019t also be in a collection. Try again " +
            "with either `collection=none` or a list of collection names (e.g. " +
            "`collection=roadmap,design`).",
    );
});

test("throws when parsing a negated no collections value", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "collection[not]=none",
        "Nothing found for `none` in the `collection` task filter. You may only filter by " +
            "task collections you\u2019ve already seen a link for, using the name from the " +
            "collection\u2019s path (e.g. `collection=roadmap` for " +
            "`/task-collection/roadmap`) or `none` for tasks in no collections (e.g. " +
            "`collection=none`). Try calling the `search` tool to find task collections.",
    );
});

test("throws when parsing a due date without an operator", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "due=2026-07-12",
        "Unexpected value `2026-07-12` for the `due` task filter in the URL search params. " +
            "Try again with `due=overdue`, `due=none` for tasks with no due date, or a date " +
            "operator (e.g. `due[before]=2026-07-12` or `due[after]=today`).",
    );
});

test("throws when parsing an unknown due value", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "due=tomorrow",
        "Unexpected value `tomorrow` for the `due` task filter in the URL search params. " +
            "Try again with `due=overdue`, `due=none` for tasks with no due date, or a date " +
            "operator (e.g. `due[before]=2026-07-12` or `due[after]=today`).",
    );
});

test("throws when parsing an unknown date", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "created[after]=someday",
        "Unexpected date `someday` in the `created[after]` task filter. Try again with an " +
            "ISO 8601 date (e.g. `created[after]=2026-07-12`), `today` (e.g. " +
            "`created[after]=today`), or a date relative to today with the units `d`, `w`, " +
            "`mo`, or `y` (e.g. `created[after]=today+2w` or `created[after]=today-3d`).",
    );
});

test("throws when parsing an impossible calendar date", async () => {
    await expectParseTaskQueryFiltersDisplayMessage(
        "due[before]=2026-13-45",
        "The date `2026-13-45` in the `due[before]` task filter isn\u2019t a real calendar " +
            "date. Try again with a valid ISO 8601 date (e.g. `due[before]=2026-07-12`).",
    );
});

test("throws when parsing a date that parses but doesn\u2019t round trip", async () => {
    // `parseDate()` accepts and coerces year 0000 to year 0001 so we reject it for not
    // printing back unchanged.
    await expectParseTaskQueryFiltersDisplayMessage(
        "due[before]=0000-01-01",
        "The date `0000-01-01` in the `due[before]` task filter isn\u2019t a real calendar " +
            "date. Try again with a valid ISO 8601 date (e.g. `due[before]=2026-07-12`).",
    );
});

test("throws when parsing an unknown date duration unit", async () => {
    // The `+` in `today+3months` decodes to a space before parsing, which is why the
    // display message quotes the date as `today 3months`.
    await expectParseTaskQueryFiltersDisplayMessage(
        "due[before]=today+3months",
        "Unexpected date `today 3months` in the `due[before]` task filter. Try again with " +
            "an ISO 8601 date (e.g. `due[before]=2026-07-12`), `today` (e.g. " +
            "`due[before]=today`), or a date relative to today with the units `d`, `w`, " +
            "`mo`, or `y` (e.g. `due[before]=today+2w` or `due[before]=today-3d`).",
    );
});
