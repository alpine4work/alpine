/* eslint-disable string-quotes */

import _Fuse from "fuse.js";
import {parseSearchNaturalLanguageQuery} from "~/server/search/data/index/internal/parse_search_natural_language_query.js";
import {
    accountNameIndexFuseMinMatchCharLength,
    accountNameIndexFuseScoreMatchCutoff,
} from "~/server/spaces/space_accounts_cache_constants.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

// Node.js ESM interop (#node-esm-migration)
type Fuse<T> = _Fuse.default<T>;
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

const createdTime = new Date();

const accounts = [
    createTestAccountModel({
        version: 0,
        name: "Budd Deey",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: createdTime,
            state: {type: "Active"},
            role: "Member",
        },
    }),
    createTestAccountModel({
        version: 0,
        name: "John Smith",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: createdTime,
            state: {type: "Active"},
            role: "Member",
        },
    }),
    createTestAccountModel({
        version: 0,
        name: "Emily Smith",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: createdTime,
            state: {type: "Active"},
            role: "Member",
        },
    }),
    createTestAccountModel({
        version: 0,
        name: "Anthony Mose",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: createdTime,
            state: {type: "Active"},
            role: "Member",
        },
    }),
    createTestAccountModel({
        version: 0,
        name: "Emily Lin",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: createdTime,
            state: {type: "Active"},
            role: "Member",
        },
    }),
];

const accountNameIndex = new Fuse(accounts, {
    includeScore: true,
    minMatchCharLength: accountNameIndexFuseMinMatchCharLength,
    keys: [
        {
            name: "name",
            getFn: account => account.initialData.name,
        },
    ],
});

const accountShortNameIndex = new Fuse(accounts, {
    includeScore: true,
    minMatchCharLength: accountNameIndexFuseMinMatchCharLength,
    keys: [
        {
            name: "name",
            getFn: account => getAccountShortNameWithoutFullNameTooltip(account.initialData),
        },
    ],
});

const options = {
    // Use fixed date and time zone to make date parsing tests easier. Using a time
    // zone that not all developer computers will be located in.
    timeZone: assertTimeZone("America/Denver"),
    currentTime: new Date("2024-01-04T13:50:03.726Z"),

    actorAccount: accounts[0]!.initialData,
    accountNameIndex: {
        searchNames: (queryText: string) => {
            return filterMapArray(accountNameIndex.search(queryText), match => {
                if (match.score! >= accountNameIndexFuseScoreMatchCutoff) return;
                return match.item;
            });
        },
        searchShortNames: (queryText: string) => {
            return filterMapArray(accountShortNameIndex.search(queryText), match => {
                if (match.score! >= accountNameIndexFuseScoreMatchCutoff) return;
                return match.item;
            });
        },
        getByIdIfExists: (id: AccountId) => {
            return accounts.find(account => account.id === id) ?? null;
        },
    },
};

describe("failure modes", () => {
    describe("describing time since now", () => {
        test("'my documents from the last 7 days' doesn't recognize control texts", () => {
            expect(
                // From after 7 days ago is BETTER than "from the last 7 days"
                // We should train the model to use that language instead. Honestly,
                // when telling the LLM how to look for date related content, we should just point
                // it to the `compromise-dates` plugin and tell it to use that documentation
                // to build date qualifiers. However, this won't fix the user experience.
                parseSearchNaturalLanguageQuery("my documents from the last 7 days", options),
            ).toEqual({
                isLowConfidence: false,
                // TODO(ifitzsimmons, #improve-search): This doesn't look right based on other tests
                // "documents created by me and created yesterday" ->
                //   - queryTexts: []
                //   - controlQueryTexts: ["documents created by me and created yesterday"]
                // If we're pattern matching, I'd expect this to say something like "my documents from
                // the last 7 days"
                queryTexts: ["from the last 7 days"],
                controlQueryTexts: ["my documents"],

                filters: [
                    {
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        entityTypes: ["Document"],
                        // TODO(ifitzsimmons, #improve-search): This should be the last 7 days
                        time: null,
                    },
                ],
            });
        });

        test("'documents I updated within the last 7 days' doesn't recognize control texts", () => {
            expect(
                parseSearchNaturalLanguageQuery(
                    "documents I updated within the last 7 days",
                    options,
                ),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: ["within the last 7 days"],
                // TODO(ifitzsimmons, #improve-search): This doesn't look right based on other tests
                controlQueryTexts: ["documents I updated"],
                filters: [
                    {
                        account: {
                            field: "AnyContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        entityTypes: ["Document"],
                        // TODO(ifitzsimmons, #improve-search): This should be the last 7 days
                        time: null,
                    },
                ],
            });
        });

        // I believe this has the same intent as the previous 2 tests, but the wording feels much
        // less natural
        test("'my documents from after 7 days ago' recognizes control texts but feels unnatural", () => {
            expect(
                // From after 7 days ago is BETTER than "from the last 7 days"
                // We should train the model to use that language instead. Honestly,
                // when telling the LLM how to look for date related content, we should just point
                // it to the `compromise-dates` plugin and tell it to use that documentation
                // to build date qualifiers. However, this won't fix the user experience.
                parseSearchNaturalLanguageQuery("my documents from after 7 days ago", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                // TODO(ifitzsimmons, #improve-search): This doesn't look right based on other tests
                // "documents created by me and created yesterday" ->
                //   - queryTexts: []
                //   - controlQueryTexts: ["documents created by me and created yesterday"]
                // If we're pattern matching, I'd expect this to say something like "my documents from
                // the last 7 days"
                controlQueryTexts: ["my documents from after 7 days ago"],
                filters: [
                    {
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        entityTypes: ["Document"],
                        time: {
                            // TODO(ifitzsimmons, #improve-search): Based on query, I think I'd
                            // expect this to be LastUpdated?
                            field: "Created",
                            range: {
                                // "today date" is 1/4/2024 so this looks about right
                                inclusiveLowerBoundDate: new Date("2023-12-28T07:00:00.000Z"),
                                inclusiveUpperBoundDate: null,
                            },
                        },
                    },
                ],
            });
        });
    });

    describe("biases toward entity creation instead of entity update", () => {
        test("'my documents from last month' only finds documents created last month", () => {
            expect(
                parseSearchNaturalLanguageQuery("my documents from last month", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["my documents from last month"],
                filters: [
                    {
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        entityTypes: ["Document"],
                        time: {
                            // TODO(ifitzsimmons, #improve-search): This should be LastUpdated?
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2023-12-01T07:00:00.000Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                            },
                        },
                    },
                ],
            });
        });
    });

    describe("tasks", () => {
        // Doesn't use assignee when user queries for "my tasks"
        test("'my tasks updated yesterday' returns tasks in which I am the major contributor", () => {
            expect(parseSearchNaturalLanguageQuery("my tasks updated yesterday", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["my tasks updated yesterday"],
                filters: [
                    {
                        // TODO(ifitzsimmons, #improve-search): I think that this should really
                        // be the Task Assignee with MajorContributor as a possible filter but with
                        // a much lower rank
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        entityTypes: ["Task", "TaskCollection"],
                        time: {
                            field: "LastUpdated",
                            range: {
                                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                            },
                        },
                    },
                ],
            });
        });

        test("'my active tasks' can't filter on task status", () => {
            expect(parseSearchNaturalLanguageQuery("my active tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: ["active"],
                controlQueryTexts: ["my", "tasks"],
                filters: [
                    {
                        // TODO(ifitzsimmons, #improve-search): I think that this should really
                        // be the Task Assignee with MajorContributor as a possible filter but with
                        // a much lower rank
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        entityTypes: ["Task", "TaskCollection"],
                        time: null,
                    },
                ],
            });
        });

        test("'my tasks due this week' can't filter on due date", () => {
            expect(parseSearchNaturalLanguageQuery("my tasks due this week", options)).toEqual({
                isLowConfidence: false,
                queryTexts: ["due this week"],
                controlQueryTexts: ["my tasks"],
                filters: [
                    {
                        // TODO(ifitzsimmons, #improve-search): I think that this should really
                        // be the Task Assignee with MajorContributor as a possible filter but with
                        // a much lower rank
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        entityTypes: ["Task", "TaskCollection"],
                        // We should have time filters for due dates
                        time: null,
                    },
                ],
            });
        });

        test("'my high priority tasks' can't filter on priority", () => {
            expect(parseSearchNaturalLanguageQuery("my high priority tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: ["high priority"],
                controlQueryTexts: ["my", "tasks"],
                filters: [
                    {
                        // TODO(ifitzsimmons, #improve-search): I think that this should really
                        // be the Task Assignee with MajorContributor as a possible filter but with
                        // a much lower rank
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        entityTypes: ["Task", "TaskCollection"],
                        // We should have time filters for due dates
                        time: null,
                    },
                ],
            });
        });
    });
});

describe("parses search entity type then account name", () => {
    expect(parseSearchNaturalLanguageQuery("documents by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {
                    field: "MajorContributor",
                    accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                },
                time: null,
            },
        ],
    });

    test("documents by", () => {
        expect(parseSearchNaturalLanguageQuery("documents by", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["by"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("documents about by", () => {
        expect(parseSearchNaturalLanguageQuery("documents about by", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["by"],
            controlQueryTexts: ["documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("documents by about", () => {
        expect(parseSearchNaturalLanguageQuery("documents by about", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["by about"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents by me about trains", () => {
        expect(parseSearchNaturalLanguageQuery("documents by me about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents by me about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("train documents by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents by john about trains", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents by john about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents by john trains", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents by john smith", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john smith", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents by john smith"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("trains1 documents by john trains2", () => {
        expect(
            parseSearchNaturalLanguageQuery("trains1 documents by john trains2", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains1", "trains2"],
            controlQueryTexts: ["documents by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("messages from emily", () => {
        expect(parseSearchNaturalLanguageQuery("messages from emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from emily"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                    time: null,
                },
            ],
        });
    });

    test("comments from emily", () => {
        expect(parseSearchNaturalLanguageQuery("comments from emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["comments from emily"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                    time: null,
                },
            ],
        });
    });

    test("post comments from emily", () => {
        expect(parseSearchNaturalLanguageQuery("post comments from emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["post comments from emily"],
            filters: [
                {
                    entityTypes: ["PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                    time: null,
                },
            ],
        });
    });

    test("messages from emily smith", () => {
        expect(parseSearchNaturalLanguageQuery("messages from emily smith", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from emily smith"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[2]!.id, name: accounts[2]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("messages from emily lin", () => {
        expect(parseSearchNaturalLanguageQuery("messages from emily lin", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from emily lin"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[4]!.id, name: accounts[4]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("messeges from emily", () => {
        expect(parseSearchNaturalLanguageQuery("messeges from emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messeges from emily"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                    time: null,
                },
            ],
        });
    });

    test("messsegees from emily", () => {
        expect(parseSearchNaturalLanguageQuery("messsegees from emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["messsegees from emily"],
            controlQueryTexts: [],
            filters: [],
        });
    });

    test("messages from sarah", () => {
        expect(parseSearchNaturalLanguageQuery("messages from sarah", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["from sarah"],
            controlQueryTexts: ["messages"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: null,
                    time: null,
                },
            ],
        });
    });
});

describe("parses search entity type then relationship then me", () => {
    test("documents created by me", () => {
        expect(parseSearchNaturalLanguageQuery("documents created by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents created me", () => {
        expect(parseSearchNaturalLanguageQuery("documents created me", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["created me"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents created by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents created by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents created by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents created by me about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents created by me about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents created by me about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents written by me", () => {
        expect(parseSearchNaturalLanguageQuery("documents written by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents written by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents written me", () => {
        expect(parseSearchNaturalLanguageQuery("documents written me", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["written me"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents written by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents written by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents written by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents written by me about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents written by me about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents written by me about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents updated by me", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents updated me", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated me", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated me"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents updated by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents updated by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents updated by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents updated by me about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents updated by me about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents updated by me about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents udpated by me", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents udpated by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents udpated me", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated me", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated me"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents udpated by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents udpated by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents udpated by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents udpated by me about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents udpated by me about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents udpated by me about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });
});

describe("parses search entity type then relationship then account name", () => {
    test("documents created by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents created by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents created by sara", () => {
        expect(parseSearchNaturalLanguageQuery("documents created by sara", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["created by sara"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("documents created john", () => {
        expect(parseSearchNaturalLanguageQuery("documents created john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["created john"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents created by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents created by john", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["train"],
                controlQueryTexts: ["documents created by john"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: {
                            field: "Creator",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: null,
                    },
                ],
            },
        );
    });

    test("documents created by john trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents created by john trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents created by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents created by john smith", () => {
        expect(parseSearchNaturalLanguageQuery("documents created by john smith", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["documents created by john smith"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: {
                            field: "Creator",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: null,
                    },
                ],
            },
        );
    });

    test("documents created by john about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents created by john about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents created by john about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents written by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents written by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents written by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents written by sara", () => {
        expect(parseSearchNaturalLanguageQuery("documents written by sara", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["written by sara"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("documents written john", () => {
        expect(parseSearchNaturalLanguageQuery("documents written john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["written john"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents written by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents written by john", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["train"],
                controlQueryTexts: ["documents written by john"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: null,
                    },
                ],
            },
        );
    });

    test("documents written by john about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents written by john about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents written by john about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents updated by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents updated john", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated john"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents updated by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents updated by john", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["train"],
                controlQueryTexts: ["documents updated by john"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: {
                            field: "AnyContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: null,
                    },
                ],
            },
        );
    });

    test("documents updated by john about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents updated by john about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents updated by john about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents updated by sara", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated by sara", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated by sara"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("documents udpated by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents udpated by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents udpated john", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated john"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents udpated by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents udpated by john", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["train"],
                controlQueryTexts: ["documents udpated by john"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: {
                            field: "AnyContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: null,
                    },
                ],
            },
        );
    });

    test("documents udpated by john about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents udpated by john about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents udpated by john about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });
});

describe("parses search entity type then I then relationship", () => {
    test("documents I created", () => {
        expect(parseSearchNaturalLanguageQuery("documents I created", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents I created"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents I", () => {
        expect(parseSearchNaturalLanguageQuery("documents I", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["I"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents I created", () => {
        expect(parseSearchNaturalLanguageQuery("train documents I created", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents I created"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents I created about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents I created about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents I created about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents I wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents I wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents I wrote"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents wrote", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["wrote"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents I wrote", () => {
        expect(parseSearchNaturalLanguageQuery("train documents I wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents I wrote"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents I wrote about trains", () => {
        expect(parseSearchNaturalLanguageQuery("documents I wrote about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents I wrote about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents I updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents I updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents I updated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents I updated", () => {
        expect(parseSearchNaturalLanguageQuery("train documents I updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents I updated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents I updated about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents I updated about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents I updated about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents I udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents I udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents I udpated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents I udpated", () => {
        expect(parseSearchNaturalLanguageQuery("train documents I udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents I udpated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents I udpated about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents I udpated about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents I udpated about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });
});

describe("parses search entity type then account first name then relationship", () => {
    test("documents john created", () => {
        expect(parseSearchNaturalLanguageQuery("documents john created", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john created"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john", () => {
        expect(parseSearchNaturalLanguageQuery("documents john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["john"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents john created", () => {
        expect(parseSearchNaturalLanguageQuery("train documents john created", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john created"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john created about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents john created about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john created about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents john wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john wrote"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents wrote", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["wrote"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents john wrote", () => {
        expect(parseSearchNaturalLanguageQuery("train documents john wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john wrote"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john wrote about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents john wrote about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john wrote about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents john updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john updated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents john updated", () => {
        expect(parseSearchNaturalLanguageQuery("train documents john updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john updated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john updated about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents john updated about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john updated about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents john udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john udpated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents john udpated", () => {
        expect(parseSearchNaturalLanguageQuery("train documents john udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john udpated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john udpated about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents john udpated about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john udpated about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });
});

describe("parses search entity type then account full name then relationship", () => {
    test("documents john smith created", () => {
        expect(parseSearchNaturalLanguageQuery("documents john smith created", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john smith created"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john smith", () => {
        expect(parseSearchNaturalLanguageQuery("documents john smith", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["john smith"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents john smith created", () => {
        expect(
            parseSearchNaturalLanguageQuery("train documents john smith created", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john smith created"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john smith created about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents john smith created about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john smith created about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john smith wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents john smith wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john smith wrote"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents wrote", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["wrote"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents john smith wrote", () => {
        expect(
            parseSearchNaturalLanguageQuery("train documents john smith wrote", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john smith wrote"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john smith wrote about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents john smith wrote about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john smith wrote about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john smith updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents john smith updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john smith updated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents john smith updated", () => {
        expect(
            parseSearchNaturalLanguageQuery("train documents john smith updated", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john smith updated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john smith updated about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents john smith updated about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john smith updated about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john smith udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents john smith udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john smith udpated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents john smith udpated", () => {
        expect(
            parseSearchNaturalLanguageQuery("train documents john smith udpated", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john smith udpated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents john smith udpated about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents john smith udpated about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john smith udpated about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });
});

describe("parses account name then entity type", () => {
    test("my documents", () => {
        expect(parseSearchNaturalLanguageQuery("my documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["my documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("train my documents", () => {
        expect(parseSearchNaturalLanguageQuery("train my documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["my documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("my documents train", () => {
        expect(parseSearchNaturalLanguageQuery("my documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["my documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("my documents about trains", () => {
        expect(parseSearchNaturalLanguageQuery("my documents about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["my documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john's documents", () => {
        expect(parseSearchNaturalLanguageQuery("john's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("train john's documents", () => {
        expect(parseSearchNaturalLanguageQuery("train john's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john's documents train", () => {
        expect(parseSearchNaturalLanguageQuery("john's documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john's documents about trains", () => {
        expect(parseSearchNaturalLanguageQuery("john's documents about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["john's documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smith's documents", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john smith's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("train john smith's documents", () => {
        expect(parseSearchNaturalLanguageQuery("train john smith's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smith's documents train", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smith's documents about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("john smith's documents about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["john smith's documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("johns documents", () => {
        expect(parseSearchNaturalLanguageQuery("johns documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["johns documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("train johns documents", () => {
        expect(parseSearchNaturalLanguageQuery("train johns documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["johns documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("johns documents train", () => {
        expect(parseSearchNaturalLanguageQuery("johns documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["johns documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("johns documents about trains", () => {
        expect(parseSearchNaturalLanguageQuery("johns documents about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["johns documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smiths documents", () => {
        expect(parseSearchNaturalLanguageQuery("john smiths documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john smiths documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("train john smiths documents", () => {
        expect(parseSearchNaturalLanguageQuery("train john smiths documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smiths documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smiths documents train", () => {
        expect(parseSearchNaturalLanguageQuery("john smiths documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smiths documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smiths documents about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("john smiths documents about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["john smiths documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john", () => {
        expect(parseSearchNaturalLanguageQuery("john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["john"],
            controlQueryTexts: [],
            filters: [],
        });
    });

    test("john smith", () => {
        expect(parseSearchNaturalLanguageQuery("john smith", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["john smith"],
            controlQueryTexts: [],
            filters: [],
        });
    });

    test("johna documents", () => {
        expect(parseSearchNaturalLanguageQuery("johna documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["johna documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("johna's documents", () => {
        expect(parseSearchNaturalLanguageQuery("johna's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["johna's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("jahn documents", () => {
        expect(parseSearchNaturalLanguageQuery("jahn documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["jahn"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("jaahn documents", () => {
        expect(parseSearchNaturalLanguageQuery("jaahn documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["jaahn"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("jaahn's documents", () => {
        expect(parseSearchNaturalLanguageQuery("jaahn's documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["jaahn's"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("jaahns documents", () => {
        expect(parseSearchNaturalLanguageQuery("jaahns documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["jaahns"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all of my documents", () => {
        expect(parseSearchNaturalLanguageQuery("all of my documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all of my documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("all of john's documents", () => {
        expect(parseSearchNaturalLanguageQuery("all of john's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all of john's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("all of my train documents", () => {
        expect(parseSearchNaturalLanguageQuery("all of my train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all of my", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("all of john's train documents", () => {
        expect(parseSearchNaturalLanguageQuery("all of john's train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all of john's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("all of documents", () => {
        expect(parseSearchNaturalLanguageQuery("all of documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["all of documents"],
            controlQueryTexts: [],
            filters: [],
        });
    });
});

describe("parses account name with some text between then entity type", () => {
    test("my train documents", () => {
        expect(parseSearchNaturalLanguageQuery("my train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["my", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john's train documents", () => {
        expect(parseSearchNaturalLanguageQuery("john's train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smith's train documents", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("my neat documents about georgia", () => {
        expect(parseSearchNaturalLanguageQuery("my neat documents about georgia", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["neat", "georgia"],
                controlQueryTexts: ["my", "documents about"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        time: null,
                    },
                ],
            },
        );
    });

    // `compromise` is interpreting this as "john has neat documents about georgia"
    // instead of interpreting "john's" as possessive. Find a way to tune
    // `compromise` to consider this possessive instead.
    //
    // This is the code which disambiguates `'s` and needs to be updated:
    // https://github.com/spencermountain/compromise/blob/4ef66b3e5798c63f3f0f3b7935ffae1597b6dd3b/src/2-two/contraction-two/compute/isPossessive.js#L45-L56
    //
    // Issue asking for guidance:
    // https://github.com/spencermountain/compromise/issues/1074
    test("john's neat documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("john's neat documents about georgia", options),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["john's neat", "georgia"],
            controlQueryTexts: ["documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("john smith's neat documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("john smith's neat documents about georgia", options),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["john smith's neat", "georgia"],
            controlQueryTexts: ["documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("my train documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("my train documents about georgia", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["train", "georgia"],
            controlQueryTexts: ["my", "documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john's train documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("john's train documents about georgia", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["train", "georgia"],
            controlQueryTexts: ["john's", "documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smith's train documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("john smith's train documents about georgia", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["train", "georgia"],
            controlQueryTexts: ["john smith's", "documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("my closed tasks", () => {
        expect(parseSearchNaturalLanguageQuery("my closed tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["closed"],
            controlQueryTexts: ["my", "tasks"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john's closed tasks", () => {
        expect(parseSearchNaturalLanguageQuery("john's closed tasks", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["john's closed"],
            controlQueryTexts: ["tasks"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("john smith's closed tasks", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's closed tasks", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["john smith's closed"],
            controlQueryTexts: ["tasks"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("my green documents", () => {
        expect(parseSearchNaturalLanguageQuery("my green documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["my", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john's green documents", () => {
        expect(parseSearchNaturalLanguageQuery("john's green documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["john's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smith's green documents", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's green documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john's smith documents", () => {
        expect(parseSearchNaturalLanguageQuery("john's smith documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john's smith documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("my the cat in the hat documents", () => {
        expect(parseSearchNaturalLanguageQuery("my the cat in the hat documents", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["the cat in the hat"],
                controlQueryTexts: ["my", "documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        time: null,
                    },
                ],
            },
        );
    });

    test("john's the cat in the hat documents", () => {
        expect(
            parseSearchNaturalLanguageQuery("john's the cat in the hat documents", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["the cat in the hat"],
            controlQueryTexts: ["john's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smith's the cat in the hat documents", () => {
        expect(
            parseSearchNaturalLanguageQuery("john smith's the cat in the hat documents", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["the cat in the hat"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("my (the cat in the hat) documents", () => {
        expect(
            parseSearchNaturalLanguageQuery("my (the cat in the hat) documents", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["(the cat in the hat)"],
            controlQueryTexts: ["my", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john's (the cat in the hat) documents", () => {
        expect(
            parseSearchNaturalLanguageQuery("john's (the cat in the hat) documents", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["(the cat in the hat)"],
            controlQueryTexts: ["john's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("john smith's (the cat in the hat) documents", () => {
        expect(
            parseSearchNaturalLanguageQuery("john smith's (the cat in the hat) documents", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["(the cat in the hat)"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("my, the cat in the hat, chat messages", () => {
        expect(
            parseSearchNaturalLanguageQuery("my, the cat in the hat, chat messages", options),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["my, the cat in the hat,"],
            controlQueryTexts: ["chat messages"],
            filters: [
                {
                    entityTypes: ["ChatMessage"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("john's, the cat in the hat, chat messages", () => {
        expect(
            parseSearchNaturalLanguageQuery("john's, the cat in the hat, chat messages", options),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["john's, the cat in the hat,"],
            controlQueryTexts: ["chat messages"],
            filters: [
                {
                    entityTypes: ["ChatMessage"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("john smith's, the cat in the hat, chat messages", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "john smith's, the cat in the hat, chat messages",
                options,
            ),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["john smith's, the cat in the hat,"],
            controlQueryTexts: ["chat messages"],
            filters: [
                {
                    entityTypes: ["ChatMessage"],
                    account: null,
                    time: null,
                },
            ],
        });
    });
});

describe("parses standalone entity type", () => {
    test("documents", () => {
        expect(parseSearchNaturalLanguageQuery("documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: [],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train documents", () => {
        expect(parseSearchNaturalLanguageQuery("train documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["train"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("documents train", () => {
        expect(parseSearchNaturalLanguageQuery("documents train", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["train"],
            controlQueryTexts: ["documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("chat message", () => {
        expect(parseSearchNaturalLanguageQuery("chat message", options)).toEqual({
            isLowConfidence: true,
            queryTexts: [],
            controlQueryTexts: ["chat message"],
            filters: [
                {
                    entityTypes: ["ChatMessage"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("messages", () => {
        expect(parseSearchNaturalLanguageQuery("messages", options)).toEqual({
            isLowConfidence: true,
            queryTexts: [],
            controlQueryTexts: ["messages"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: null,
                    time: null,
                },
            ],
        });
    });
});

describe("correctly splits query texts", () => {
    test("train1 train2 documents train3 train4 chat train5 train6", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "train1 train2 documents train3 train4 chat train5 train6",
                options,
            ),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["train1 train2", "train3 train4", "train5 train6"],
            controlQueryTexts: ["documents", "chat"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
                {
                    entityTypes: ["Chat"],
                    account: null,
                    time: null,
                },
            ],
        });
    });
});

describe("provides duration slop when referencing precise date", () => {
    test("documents created 1 minute ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 1 minute ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 1 minute ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-04T13:30:18.830Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T14:07:48.621Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 2 minutes ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 minutes ago", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["documents created 2 minutes ago"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: {
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2024-01-04T13:29:14.759Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-04T14:06:52.692Z"),
                            },
                        },
                    },
                ],
            },
        );
    });

    test("documents created 5 minutes ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 5 minutes ago", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["documents created 5 minutes ago"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: {
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2024-01-04T13:26:02.540Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-04T14:04:04.911Z"),
                            },
                        },
                    },
                ],
            },
        );
    });

    test("documents created 1 hour ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 1 hour ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 1 hour ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-04T12:27:17.615Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T13:12:49.836Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 2 hours ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 hours ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 2 hours ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-04T11:23:10.255Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T12:16:57.196Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 24 hours ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 24 hours ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 24 hours ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T11:43:48.649Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T15:56:18.802Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("documents created yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created yesterday"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 2 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 2 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 3 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 3 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 3 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-01T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-02T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 4 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 4 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 4 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-31T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 5 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 5 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 5 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-30T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-31T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 6 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 6 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 6 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-29T04:00:41.781Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-30T09:59:18.217Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created last week", () => {
        expect(parseSearchNaturalLanguageQuery("documents created last week", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created last week"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-25T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 2 weeks ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 weeks ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 2 weeks ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created last month", () => {
        expect(parseSearchNaturalLanguageQuery("documents created last month", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created last month"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-01T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 2 months ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 months ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 2 months ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-10-20T17:59:59.999Z"),
                            inclusiveUpperBoundDate: new Date("2023-11-19T17:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 3 months ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 3 months ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 3 months ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-09-19T17:59:59.999Z"),
                            inclusiveUpperBoundDate: new Date("2023-10-19T17:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 4 months ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 4 months ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 4 months ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-08-20T17:59:59.999Z"),
                            inclusiveUpperBoundDate: new Date("2023-09-19T17:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created 6 months ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 6 months ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 6 months ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-06-19T17:59:59.999Z"),
                            inclusiveUpperBoundDate: new Date("2023-07-19T17:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });
});

describe("parses entity type then date field then date", () => {
    test("documents created 2 weeks ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 weeks ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 2 weeks ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents updated 2 weeks ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated 2 weeks ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated 2 weeks ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents last updated 2 weeks ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents last updated 2 weeks ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents last updated 2 weeks ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents udpated 2 weeks ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated 2 weeks ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents udpated 2 weeks ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents last udpated 2 weeks ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents last udpated 2 weeks ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents last udpated 2 weeks ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents updated before 2 weeks ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents updated before 2 weeks ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated before 2 weeks ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: null,
                            inclusiveUpperBoundDate: new Date("2023-12-22T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents updated after 2 weeks ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents updated after 2 weeks ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated after 2 weeks ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-21T07:00:00.000Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                },
            ],
        });
    });

    test("messages sent after yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("messages sent after yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages sent after yesterday"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                },
            ],
        });
    });

    test("messages sent before yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("messages sent before yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages sent before yesterday"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: null,
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    expect(parseSearchNaturalLanguageQuery("posts from yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["posts from yesterday"],
        filters: [
            {
                entityTypes: ["Post"],
                account: null,
                time: {
                    field: "Created",
                    range: {
                        inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                        inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                    },
                },
            },
        ],
    });
});

describe("parses entity type then multiple modifiers", () => {
    const filter = {
        entityTypes: ["Document"],
        account: {
            field: "Creator",
            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
        },
        time: {
            field: "Created",
            range: {
                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
            },
        },
    };
    test("documents created by me and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created by me and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created by me and created yesterday"],
            filters: [filter],
        });
    });

    test("documents created by me that were created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created by me that were created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created by me that were created yesterday"],
            filters: [filter],
        });
    });

    test("documents created by me and were created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created by me and were created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created by me and were created yesterday"],
            filters: [filter],
        });
    });

    test("documents created by me created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents created by me created yesterday", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created by me created yesterday"],
            filters: [filter],
        });
    });

    test("documents created yesterday and created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created yesterday and created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created yesterday and created by me"],
            filters: [filter],
        });
    });

    test("documents created yesterday that were created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created yesterday that were created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created yesterday that were created by me"],
            filters: [filter],
        });
    });

    test("documents created yesterday and were created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created yesterday and were created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created yesterday and were created by me"],
            filters: [filter],
        });
    });

    test("documents created yesterday created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents created yesterday created by me", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created yesterday created by me"],
            filters: [filter],
        });
    });

    test("documents written by me and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents written by me and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents written by me and created yesterday"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents updated by me and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents updated by me and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated by me and created yesterday"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents written yesterday and created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents written yesterday and created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents written yesterday and created by me"],
            filters: [filter],
        });
    });

    test("documents updated yesterday and created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents updated yesterday and created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated yesterday and created by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });
});

describe("parses entity type then multiple modifiers won't double parse modifiers", () => {
    const filter = {
        entityTypes: ["Document"],
        account: {
            field: "Creator",
            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
        },
        time: {
            field: "Created",
            range: {
                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
            },
        },
    };

    test("documents created by me and created yesterday and created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created by me and created yesterday and created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created by me"],
            controlQueryTexts: ["documents created by me and created yesterday"],
            filters: [filter],
        });
    });

    test("documents written by me and created yesterday and created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents written by me and created yesterday and created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created by me"],
            controlQueryTexts: ["documents written by me and created yesterday"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents updated by me and created yesterday and created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents updated by me and created yesterday and created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created by me"],
            controlQueryTexts: ["documents updated by me and created yesterday"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created yesterday and created by me and created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created yesterday and created by me and created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created by me"],
            controlQueryTexts: ["documents created yesterday and created by me"],
            filters: [filter],
        });
    });

    test("documents written yesterday and created by me and created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents written yesterday and created by me and created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created by me"],
            controlQueryTexts: ["documents written yesterday and created by me"],
            filters: [filter],
        });
    });

    test("documents updated yesterday and created by me and created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents updated yesterday and created by me and created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created by me"],
            controlQueryTexts: ["documents updated yesterday and created by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created by me and created yesterday and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created by me and created yesterday and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created yesterday"],
            controlQueryTexts: ["documents created by me and created yesterday"],
            filters: [filter],
        });
    });

    test("documents written by me and created yesterday and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents written by me and created yesterday and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created yesterday"],
            controlQueryTexts: ["documents written by me and created yesterday"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents updated by me and created yesterday and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents updated by me and created yesterday and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created yesterday"],
            controlQueryTexts: ["documents updated by me and created yesterday"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents created yesterday and created by me and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created yesterday and created by me and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created yesterday"],
            controlQueryTexts: ["documents created yesterday and created by me"],
            filters: [filter],
        });
    });

    test("documents written yesterday and created by me and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents written yesterday and created by me and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created yesterday"],
            controlQueryTexts: ["documents written yesterday and created by me"],
            filters: [filter],
        });
    });

    test("documents updated yesterday and created by me and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents updated yesterday and created by me and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and created yesterday"],
            controlQueryTexts: ["documents updated yesterday and created by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents by john by me", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["by me"],
            controlQueryTexts: ["documents by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents by me by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents by me by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["by john"],
            controlQueryTexts: ["documents by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents from two days ago and then from yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents from two days ago and then from yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and then from yesterday"],
            controlQueryTexts: ["documents from two days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });
});

describe("parses simpler entity type then multiple modifiers", () => {
    const filter = {
        entityTypes: ["Document"],
        account: {
            field: "MajorContributor",
            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
        },
        time: {
            field: "Created",
            range: {
                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
            },
        },
    };

    test("documents by me created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents by me created yesterday", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents by me created yesterday"],
            filters: [filter],
        });
    });

    test("documents by me that were created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents by me that were created yesterday", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents by me that were created yesterday"],
            filters: [filter],
        });
    });

    test("documents from me that were created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents from me that were created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents from me that were created yesterday"],
            filters: [filter],
        });
    });

    test("documents from yesterday that I created", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents from yesterday that I created", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents from yesterday that I created"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("documents I created from yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery("documents I created from yesterday", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents I created from yesterday"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });
});

describe("parses entity type then account then shortcuts to time", () => {
    test("tasks I created yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks I created yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks I created yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks by me yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks by me yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks by me yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks created by me yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks created by me yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks created by me yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks written by me yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks written by me yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks written by me yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks I updated yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks I updated yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks I updated yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks updated by me yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks updated by me yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks updated by me yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks john created yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks john created yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks john created yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks by john yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks by john yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks by john yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks created by john yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks created by john yesterday", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["tasks created by john yesterday"],
                filters: [
                    {
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "Creator",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: {
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                            },
                        },
                    },
                ],
            },
        );
    });

    test("tasks written by john yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks written by john yesterday", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["tasks written by john yesterday"],
                filters: [
                    {
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: {
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                            },
                        },
                    },
                ],
            },
        );
    });

    test("tasks john updated yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks john updated yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks john updated yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks updated by john yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks updated by john yesterday", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["tasks updated by john yesterday"],
                filters: [
                    {
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "AnyContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: {
                            field: "LastUpdated",
                            range: {
                                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                            },
                        },
                    },
                ],
            },
        );
    });

    test("tasks I created before yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery("tasks I created before yesterday", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks I created before yesterday"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: null,
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("tasks I created before and created yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "tasks I created before and created yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["before and created yesterday"],
            controlQueryTexts: ["tasks I created"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("messages from me last week", () => {
        expect(parseSearchNaturalLanguageQuery("messages from me last week", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from me last week"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-25T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("messages from john last week", () => {
        expect(parseSearchNaturalLanguageQuery("messages from john last week", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from john last week"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-25T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });
});

describe("parses date modifier after account name then entity type", () => {
    test("my documents created two days ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("my documents created two days ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["my documents created two days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("john's documents created two days ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("john's documents created two days ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john's documents created two days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("my green documents created two days ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("my green documents created two days ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["my", "documents created two days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("john's green documents created two days ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("john's green documents created two days ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["john's", "documents created two days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });
});

describe('parses the word "recently" in dates', () => {
    test("documents created recently", () => {
        expect(parseSearchNaturalLanguageQuery("documents created recently", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created recently"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-01T13:50:03.726Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                },
            ],
        });
    });

    test("documents i updated recently", () => {
        expect(parseSearchNaturalLanguageQuery("documents i updated recently", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents i updated recently"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-01T13:50:03.726Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                },
            ],
        });
    });

    test("chat messages sent recently by john", () => {
        expect(
            parseSearchNaturalLanguageQuery("chat messages sent recently by john", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["chat messages sent recently by john"],
            filters: [
                {
                    entityTypes: ["ChatMessage"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-01T13:50:03.726Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                },
            ],
        });
    });
});

describe('parses "all" then entity type', () => {
    test("all documents", () => {
        expect(parseSearchNaturalLanguageQuery("all documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("train all documents", () => {
        expect(parseSearchNaturalLanguageQuery("train all documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all documents train", () => {
        expect(parseSearchNaturalLanguageQuery("all documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all documents about trains", () => {
        expect(parseSearchNaturalLanguageQuery("all documents about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["all documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });
});

describe('parses "all" with some text between then entity type', () => {
    test("all train documents", () => {
        expect(parseSearchNaturalLanguageQuery("all train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all neat documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("all neat documents about georgia", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["neat", "georgia"],
            controlQueryTexts: ["all", "documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all train documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("all train documents about georgia", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["train", "georgia"],
            controlQueryTexts: ["all", "documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all closed tasks", () => {
        expect(parseSearchNaturalLanguageQuery("all closed tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["closed"],
            controlQueryTexts: ["all", "tasks"],
            filters: [
                {
                    entityTypes: ["Task", "TaskCollection"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all green documents", () => {
        expect(parseSearchNaturalLanguageQuery("all green documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["all", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all the cat in the hat documents", () => {
        expect(
            parseSearchNaturalLanguageQuery("all the cat in the hat documents", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["the cat in the hat"],
            controlQueryTexts: ["all", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all (the cat in the hat) documents", () => {
        expect(
            parseSearchNaturalLanguageQuery("all (the cat in the hat) documents", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["(the cat in the hat)"],
            controlQueryTexts: ["all", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: null,
                },
            ],
        });
    });

    test("all, the cat in the hat, chat messages", () => {
        expect(
            parseSearchNaturalLanguageQuery("all, the cat in the hat, chat messages", options),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["all, the cat in the hat,"],
            controlQueryTexts: ["chat messages"],
            filters: [
                {
                    entityTypes: ["ChatMessage"],
                    account: null,
                    time: null,
                },
            ],
        });
    });
});

describe('parses date modifier after "all" then entity type', () => {
    test("all documents created two days ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("all documents created two days ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all documents created two days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });

    test("all green documents created two days ago", () => {
        expect(
            parseSearchNaturalLanguageQuery("all green documents created two days ago", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["all", "documents created two days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                },
            ],
        });
    });
});

describe('parses account name after "all" then entity type', () => {
    test("all documents by me", () => {
        expect(parseSearchNaturalLanguageQuery("all documents by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all documents by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("all train documents by me", () => {
        expect(parseSearchNaturalLanguageQuery("all train documents by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all", "documents by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("all documents by me about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("all documents by me about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["all documents by me about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("all documents by john", () => {
        expect(parseSearchNaturalLanguageQuery("all documents by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all documents by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("all train documents by john", () => {
        expect(parseSearchNaturalLanguageQuery("all train documents by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all", "documents by john"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("all documents by john about trains", () => {
        expect(
            parseSearchNaturalLanguageQuery("all documents by john about trains", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["all documents by john about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });
});

describe("handles null actorAccount gracefully for bot searches", () => {
    const botOptions = {
        ...options,
        actorAccount: null,
    };

    describe('"my" keyword handling', () => {
        test("my documents - treats 'my' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("my documents", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["my"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("documents about my weekend plans - treats 'my' as regular text", () => {
            expect(
                parseSearchNaturalLanguageQuery("documents about my weekend plans", botOptions),
            ).toEqual({
                isLowConfidence: true,
                queryTexts: ["my weekend plans"],
                controlQueryTexts: ["documents about"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("my tasks - treats 'my' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("my tasks", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["my"],
                controlQueryTexts: ["tasks"],
                filters: [
                    {
                        entityTypes: ["Task", "TaskCollection"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });
    });

    describe('"me" keyword handling', () => {
        test("documents created by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents created by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["created by me"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("documents written by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents written by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["written by me"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("documents updated by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents updated by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["updated by me"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("documents by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["by me"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("messages sent by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("messages sent by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["sent by me"],
                controlQueryTexts: ["messages"],
                filters: [
                    {
                        entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("posts authored by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("posts authored by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["authored by me"],
                controlQueryTexts: ["posts"],
                filters: [
                    {
                        entityTypes: ["Post"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });
    });

    describe('"I" keyword handling', () => {
        test("documents I created - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I created", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I created"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("documents I sent - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I sent", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I sent"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("documents I wrote - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I wrote", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I wrote"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("documents I authored - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I authored", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I authored"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("documents I updated - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I updated", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I updated"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("messages I posted - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("messages I posted", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I"],
                controlQueryTexts: ["messages", "posted"],
                filters: [
                    {
                        entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                        account: null,
                        time: null,
                    },
                    {
                        account: null,
                        entityTypes: ["Post"],
                        time: null,
                    },
                ],
            });
        });
    });

    describe("complex queries with first-person keywords", () => {
        test("find documents about my project - treats 'my' as regular text", () => {
            expect(
                parseSearchNaturalLanguageQuery("find documents about my project", botOptions),
            ).toEqual({
                isLowConfidence: true,
                queryTexts: ["find", "my project"],
                controlQueryTexts: ["documents about"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("tasks about me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("tasks about me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["me"],
                controlQueryTexts: ["tasks about"],
                filters: [
                    {
                        entityTypes: ["Task", "TaskCollection"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });

        test("documents containing I and me - treats both as regular text", () => {
            expect(
                parseSearchNaturalLanguageQuery("documents containing I and me", botOptions),
            ).toEqual({
                isLowConfidence: true,
                queryTexts: ["containing I and me"],
                controlQueryTexts: ["documents"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: null,
                    },
                ],
            });
        });
    });

    describe("bot searches still support other filters", () => {
        test("documents by john - still parses account names", () => {
            expect(parseSearchNaturalLanguageQuery("documents by john", botOptions)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["documents by john"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: null,
                    },
                ],
            });
        });

        test("documents created last week - still parses dates", () => {
            expect(
                parseSearchNaturalLanguageQuery("documents created last week", botOptions),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["documents created last week"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: null,
                        time: {
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2023-12-25T07:00:00.000Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                            },
                        },
                    },
                ],
            });
        });

        test("documents by john updated yesterday - combines account and date filters", () => {
            expect(
                parseSearchNaturalLanguageQuery("documents by john updated yesterday", botOptions),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["documents by john updated yesterday"],
                filters: [
                    {
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                        time: {
                            field: "LastUpdated",
                            range: {
                                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                            },
                        },
                    },
                ],
            });
        });
    });
});

describe("creates multiple filters", () => {
    test("documents created by john and documents created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created by john and documents created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["and"],
            controlQueryTexts: ["documents created by john", "documents created by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    test("documents created by john or documents created by me", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "documents created by john or documents created by me",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["or"],
            controlQueryTexts: ["documents created by john", "documents created by me"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    time: null,
                },
                {
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    time: null,
                },
            ],
        });
    });

    // TODO: The following query should probably generate a filter with multiple
    // acount Ids.
    test.todo("documents created by john and me");

    // TODO: The following query should probably generate multiple filters
    test.todo("documents created by john or me");
});
