/* eslint-disable cyberworlds/string-quotes */

import {CalendarDate} from "@internationalized/date";
import _Fuse from "fuse.js";
import {
    SearchNaturalLanguageFilter,
    parseSearchNaturalLanguageQuery,
} from "~/server/search/data/index/internal/parse_search_natural_language_query.js";
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

const accounts = [
    createTestAccountModel({name: "Budd Deey"}),
    createTestAccountModel({name: "John Smith"}),
    createTestAccountModel({name: "Emily Smith"}),
    createTestAccountModel({name: "Anthony Mose"}),
    createTestAccountModel({name: "Emily Lin"}),
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

describe("failure modes", () => {
    describe("describing time since now", () => {
        test("'my documents from the last 7 days' doesn't recognize control texts", () => {
            expect(
                // From after 7 days ago is BETTER than "from the last 7 days" We should train the
                // model to use that language instead. Honestly, when telling the LLM how to look
                // for date related content, we should just point it to the `compromise-dates`
                // plugin and tell it to use that documentation to build date qualifiers. However,
                // this won't fix the user experience.
                parseSearchNaturalLanguageQuery("my documents from the last 7 days", options),
            ).toEqual({
                isLowConfidence: false,
                // TODO(ifitzsimmons, #improve-search): This doesn't look right based on other
                // tests "documents created by me and created yesterday" ->
                //
                // - queryTexts: []
                // - controlQueryTexts: ["documents created by me and created yesterday"] If we're
                //   pattern matching, I'd expect this to say something like "my documents from the
                //   last 7 days"
                queryTexts: ["from the last 7 days"],
                controlQueryTexts: ["my documents"],

                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        // TODO(ifitzsimmons, #improve-search): This should be the last 7 days
                        time: null,
                    }),
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
                // TODO(ifitzsimmons, #improve-search): This doesn't look right based on other
                // tests
                controlQueryTexts: ["documents I updated"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "AnyContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        // TODO(ifitzsimmons, #improve-search): This should be the last 7 days
                        time: null,
                    }),
                ],
            });
        });

        // I believe this has the same intent as the previous 2 tests, but the wording
        // feels much less natural
        test("'my documents from after 7 days ago' recognizes control texts but feels unnatural", () => {
            expect(
                // From after 7 days ago is BETTER than "from the last 7 days" We should train the
                // model to use that language instead. Honestly, when telling the LLM how to look
                // for date related content, we should just point it to the `compromise-dates`
                // plugin and tell it to use that documentation to build date qualifiers. However,
                // this won't fix the user experience.
                parseSearchNaturalLanguageQuery("my documents from after 7 days ago", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                // TODO(ifitzsimmons, #improve-search): This doesn't look right based on other
                // tests "documents created by me and created yesterday" ->
                //
                // - queryTexts: []
                // - controlQueryTexts: ["documents created by me and created yesterday"] If we're
                //   pattern matching, I'd expect this to say something like "my documents from the
                //   last 7 days"
                controlQueryTexts: ["my documents from after 7 days ago"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        time: {
                            // TODO(ifitzsimmons, #improve-search): Based on query, I think I'd expect this to
                            // be LastUpdated?
                            field: "Created",
                            range: {
                                // "today date" is 1/4/2024 so this looks about right
                                inclusiveLowerBoundDate: new Date("2023-12-28T07:00:00.000Z"),
                                inclusiveUpperBoundDate: null,
                            },
                        },
                    }),
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
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [
                                {
                                    id: options.actorAccount.id,
                                    name: options.actorAccount.name,
                                },
                            ],
                        },
                        time: {
                            // TODO(ifitzsimmons, #improve-search): This should be LastUpdated?
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2023-12-01T07:00:00.000Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                            },
                        },
                    }),
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
            createDefaultedFilter({
                entityTypes: ["Document"],
                account: {
                    field: "MajorContributor",
                    accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                },
            }),
        ],
    });

    test("documents by", () => {
        expect(parseSearchNaturalLanguageQuery("documents by", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["by"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("documents about by", () => {
        expect(parseSearchNaturalLanguageQuery("documents about by", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["by"],
            controlQueryTexts: ["documents about"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("documents by about", () => {
        expect(parseSearchNaturalLanguageQuery("documents by about", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["by about"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents by me about trains", () => {
        expect(parseSearchNaturalLanguageQuery("documents by me about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents by me about"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents by john"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("train documents by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents by john"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents by john about trains", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents by john about"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents by john trains", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents by john"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents by john smith", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john smith", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents by john smith"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("messages from emily", () => {
        expect(parseSearchNaturalLanguageQuery("messages from emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from emily"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                }),
            ],
        });
    });

    test("comments from emily", () => {
        expect(parseSearchNaturalLanguageQuery("comments from emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["comments from emily"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                }),
            ],
        });
    });

    test("post comments from emily", () => {
        expect(parseSearchNaturalLanguageQuery("post comments from emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["post comments from emily"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                }),
            ],
        });
    });

    test("messages from emily smith", () => {
        expect(parseSearchNaturalLanguageQuery("messages from emily smith", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from emily smith"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[2]!.id, name: accounts[2]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("messages from emily lin", () => {
        expect(parseSearchNaturalLanguageQuery("messages from emily lin", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from emily lin"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[4]!.id, name: accounts[4]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("messeges from emily", () => {
        expect(parseSearchNaturalLanguageQuery("messeges from emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messeges from emily"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    account: {
                        field: "MajorContributor",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents created me", () => {
        expect(parseSearchNaturalLanguageQuery("documents created me", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["created me"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents created by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents created by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents created by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents written by me", () => {
        expect(parseSearchNaturalLanguageQuery("documents written by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents written by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents written me", () => {
        expect(parseSearchNaturalLanguageQuery("documents written me", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["written me"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents written by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents written by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents written by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents updated by me", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents updated me", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated me", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated me"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents updated by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents updated by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents updated by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents udpated by me", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents udpated by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents udpated me", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated me", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated me"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents udpated by me", () => {
        expect(parseSearchNaturalLanguageQuery("train documents udpated by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents udpated by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents created by sara", () => {
        expect(parseSearchNaturalLanguageQuery("documents created by sara", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["created by sara"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("documents created john", () => {
        expect(parseSearchNaturalLanguageQuery("documents created john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["created john"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents created by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents created by john", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["train"],
                controlQueryTexts: ["documents created by john"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "Creator",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                    }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "Creator",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                    }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents written by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents written by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents written by john"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents written by sara", () => {
        expect(parseSearchNaturalLanguageQuery("documents written by sara", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["written by sara"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("documents written john", () => {
        expect(parseSearchNaturalLanguageQuery("documents written john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["written john"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents written by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents written by john", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["train"],
                controlQueryTexts: ["documents written by john"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                    }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents updated by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated by john"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents updated john", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated john"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents updated by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents updated by john", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["train"],
                controlQueryTexts: ["documents updated by john"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "AnyContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                    }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents updated by sara", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated by sara", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated by sara"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("documents udpated by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents udpated by john"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents udpated john", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated john"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents udpated by john", () => {
        expect(parseSearchNaturalLanguageQuery("train documents udpated by john", options)).toEqual(
            {
                isLowConfidence: false,
                queryTexts: ["train"],
                controlQueryTexts: ["documents udpated by john"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "AnyContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                    }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents I", () => {
        expect(parseSearchNaturalLanguageQuery("documents I", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["I"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents I created", () => {
        expect(parseSearchNaturalLanguageQuery("train documents I created", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents I created"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents I wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents I wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents I wrote"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents wrote", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["wrote"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents I wrote", () => {
        expect(parseSearchNaturalLanguageQuery("train documents I wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents I wrote"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents I wrote about trains", () => {
        expect(parseSearchNaturalLanguageQuery("documents I wrote about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents I wrote about"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents I updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents I updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents I updated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents I updated", () => {
        expect(parseSearchNaturalLanguageQuery("train documents I updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents I updated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents I udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents I udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents I udpated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents I udpated", () => {
        expect(parseSearchNaturalLanguageQuery("train documents I udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents I udpated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents john", () => {
        expect(parseSearchNaturalLanguageQuery("documents john", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["john"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents john created", () => {
        expect(parseSearchNaturalLanguageQuery("train documents john created", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john created"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents john wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents john wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john wrote"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents wrote", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["wrote"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents john wrote", () => {
        expect(parseSearchNaturalLanguageQuery("train documents john wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john wrote"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents john updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents john updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john updated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents john updated", () => {
        expect(parseSearchNaturalLanguageQuery("train documents john updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john updated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents john udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents john udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john udpated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents john udpated", () => {
        expect(parseSearchNaturalLanguageQuery("train documents john udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["documents john udpated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents john smith", () => {
        expect(parseSearchNaturalLanguageQuery("documents john smith", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["john smith"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents john smith wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents john smith wrote", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john smith wrote"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents wrote", () => {
        expect(parseSearchNaturalLanguageQuery("documents wrote", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["wrote"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents john smith updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents john smith updated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john smith updated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents updated", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["updated"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents john smith udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents john smith udpated", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents john smith udpated"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents udpated", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["udpated"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "AnyContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("train my documents", () => {
        expect(parseSearchNaturalLanguageQuery("train my documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["my documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("my documents train", () => {
        expect(parseSearchNaturalLanguageQuery("my documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["my documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("my documents about trains", () => {
        expect(parseSearchNaturalLanguageQuery("my documents about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["my documents about"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john's documents", () => {
        expect(parseSearchNaturalLanguageQuery("john's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john's documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("train john's documents", () => {
        expect(parseSearchNaturalLanguageQuery("train john's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john's documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john's documents train", () => {
        expect(parseSearchNaturalLanguageQuery("john's documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john's documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john's documents about trains", () => {
        expect(parseSearchNaturalLanguageQuery("john's documents about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["john's documents about"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john smith's documents", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john smith's documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("train john smith's documents", () => {
        expect(parseSearchNaturalLanguageQuery("train john smith's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john smith's documents train", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("johns documents", () => {
        expect(parseSearchNaturalLanguageQuery("johns documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["johns documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("train johns documents", () => {
        expect(parseSearchNaturalLanguageQuery("train johns documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["johns documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("johns documents train", () => {
        expect(parseSearchNaturalLanguageQuery("johns documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["johns documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("johns documents about trains", () => {
        expect(parseSearchNaturalLanguageQuery("johns documents about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["johns documents about"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john smiths documents", () => {
        expect(parseSearchNaturalLanguageQuery("john smiths documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john smiths documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("train john smiths documents", () => {
        expect(parseSearchNaturalLanguageQuery("train john smiths documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smiths documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john smiths documents train", () => {
        expect(parseSearchNaturalLanguageQuery("john smiths documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smiths documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("johna's documents", () => {
        expect(parseSearchNaturalLanguageQuery("johna's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["johna's documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("jahn documents", () => {
        expect(parseSearchNaturalLanguageQuery("jahn documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["jahn"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("jaahn documents", () => {
        expect(parseSearchNaturalLanguageQuery("jaahn documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["jaahn"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("jaahn's documents", () => {
        expect(parseSearchNaturalLanguageQuery("jaahn's documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["jaahn's"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("jaahns documents", () => {
        expect(parseSearchNaturalLanguageQuery("jaahns documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["jaahns"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("all of my documents", () => {
        expect(parseSearchNaturalLanguageQuery("all of my documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all of my documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("all of john's documents", () => {
        expect(parseSearchNaturalLanguageQuery("all of john's documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all of john's documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("all of my train documents", () => {
        expect(parseSearchNaturalLanguageQuery("all of my train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all of my", "documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("all of john's train documents", () => {
        expect(parseSearchNaturalLanguageQuery("all of john's train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all of john's", "documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john's train documents", () => {
        expect(parseSearchNaturalLanguageQuery("john's train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john's", "documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john smith's train documents", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                    }),
                ],
            },
        );
    });

    // `compromise` is interpreting this as "john has neat documents about georgia"
    // instead of interpreting "john's" as possessive. Find a way to tune `compromise`
    // to consider this possessive instead.
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
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("john smith's neat documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("john smith's neat documents about georgia", options),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["john smith's neat", "georgia"],
            controlQueryTexts: ["documents about"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("my closed tasks", () => {
        expect(parseSearchNaturalLanguageQuery("my closed tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["my", "closed tasks"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    openness: ["Closed"],
                }),
            ],
        });
    });

    test("john's closed tasks", () => {
        expect(parseSearchNaturalLanguageQuery("john's closed tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john's", "closed tasks"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    openness: ["Closed"],
                }),
            ],
        });
    });

    test("john smith's closed tasks", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's closed tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john smith's", "closed tasks"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    openness: ["Closed"],
                }),
            ],
        });
    });

    test("john's open tasks", () => {
        expect(parseSearchNaturalLanguageQuery("john's open tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john's", "open tasks"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    openness: ["Open"],
                }),
            ],
        });
    });

    test("all of john's open tasks", () => {
        expect(parseSearchNaturalLanguageQuery("all of john's open tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all of john's", "open tasks"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    openness: ["Open"],
                }),
            ],
        });
    });

    test("all of john's open tasks that are urgent", () => {
        expect(
            parseSearchNaturalLanguageQuery("all of john's open tasks that are urgent", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all of john's", "open tasks that are urgent"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    openness: ["Open"],
                    priority: ["Urgent"],
                }),
            ],
        });
    });

    test("my green documents", () => {
        expect(parseSearchNaturalLanguageQuery("my green documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["my", "documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john's green documents", () => {
        expect(parseSearchNaturalLanguageQuery("john's green documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["john's", "documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john smith's green documents", () => {
        expect(parseSearchNaturalLanguageQuery("john smith's green documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("john's smith documents", () => {
        expect(parseSearchNaturalLanguageQuery("john's smith documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["john's smith documents"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                    }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
            filters: [createDefaultedFilter({entityTypes: ["ChatMessage"]})],
        });
    });

    test("john's, the cat in the hat, chat messages", () => {
        expect(
            parseSearchNaturalLanguageQuery("john's, the cat in the hat, chat messages", options),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["john's, the cat in the hat,"],
            controlQueryTexts: ["chat messages"],
            filters: [createDefaultedFilter({entityTypes: ["ChatMessage"]})],
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
            filters: [createDefaultedFilter({entityTypes: ["ChatMessage"]})],
        });
    });
});

describe("parses standalone entity type", () => {
    test("documents", () => {
        expect(parseSearchNaturalLanguageQuery("documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: [],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train documents", () => {
        expect(parseSearchNaturalLanguageQuery("train documents", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["train"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("documents train", () => {
        expect(parseSearchNaturalLanguageQuery("documents train", options)).toEqual({
            isLowConfidence: true,
            queryTexts: ["train"],
            controlQueryTexts: ["documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("chat message", () => {
        expect(parseSearchNaturalLanguageQuery("chat message", options)).toEqual({
            isLowConfidence: true,
            queryTexts: [],
            controlQueryTexts: ["chat message"],
            filters: [createDefaultedFilter({entityTypes: ["ChatMessage"]})],
        });
    });

    test("messages", () => {
        expect(parseSearchNaturalLanguageQuery("messages", options)).toEqual({
            isLowConfidence: true,
            queryTexts: [],
            controlQueryTexts: ["messages"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                }),
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
                createDefaultedFilter({entityTypes: ["Document"]}),
                createDefaultedFilter({entityTypes: ["Chat"]}),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-04T13:30:18.830Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T14:07:48.621Z"),
                        },
                    },
                }),
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
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        time: {
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2024-01-04T13:29:14.759Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-04T14:06:52.692Z"),
                            },
                        },
                    }),
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
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        time: {
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2024-01-04T13:26:02.540Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-04T14:04:04.911Z"),
                            },
                        },
                    }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-04T12:27:17.615Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T13:12:49.836Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 2 hours ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 hours ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 2 hours ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-04T11:23:10.255Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T12:16:57.196Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 24 hours ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 24 hours ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 24 hours ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T11:43:48.649Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T15:56:18.802Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("documents created yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created yesterday"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 2 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 2 days ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 3 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 3 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 3 days ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-01T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-02T06:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 4 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 4 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 4 days ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-31T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 5 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 5 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 5 days ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-30T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-31T06:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 6 days ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 6 days ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 6 days ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-29T04:00:41.781Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-30T09:59:18.217Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created last week", () => {
        expect(parseSearchNaturalLanguageQuery("documents created last week", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created last week"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-25T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 2 weeks ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 weeks ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 2 weeks ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created last month", () => {
        expect(parseSearchNaturalLanguageQuery("documents created last month", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created last month"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-01T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 2 months ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 2 months ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 2 months ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-10-20T17:59:59.999Z"),
                            inclusiveUpperBoundDate: new Date("2023-11-19T17:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 3 months ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 3 months ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 3 months ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-09-19T17:59:59.999Z"),
                            inclusiveUpperBoundDate: new Date("2023-10-19T17:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 4 months ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 4 months ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 4 months ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-08-20T17:59:59.999Z"),
                            inclusiveUpperBoundDate: new Date("2023-09-19T17:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents created 6 months ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents created 6 months ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents created 6 months ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-06-19T17:59:59.999Z"),
                            inclusiveUpperBoundDate: new Date("2023-07-19T17:59:59.999Z"),
                        },
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents updated 2 weeks ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents updated 2 weeks ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents updated 2 weeks ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                }),
            ],
        });
    });

    test("documents udpated 2 weeks ago", () => {
        expect(parseSearchNaturalLanguageQuery("documents udpated 2 weeks ago", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents udpated 2 weeks ago"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-19T16:44:28.090Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-23T21:15:31.908Z"),
                        },
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: null,
                            inclusiveUpperBoundDate: new Date("2023-12-22T06:59:59.999Z"),
                        },
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-21T07:00:00.000Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                }),
            ],
        });
    });

    test("messages sent after yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("messages sent after yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages sent after yesterday"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                }),
            ],
        });
    });

    test("messages sent before yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("messages sent before yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages sent before yesterday"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: null,
                            inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });

    expect(parseSearchNaturalLanguageQuery("posts from yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["posts from yesterday"],
        filters: [
            createDefaultedFilter({
                entityTypes: ["Post"],
                time: {
                    field: "Created",
                    range: {
                        inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                        inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
                    },
                },
            }),
        ],
    });
});

describe("parses entity type then multiple modifiers", () => {
    const filter = createDefaultedFilter({
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
    });
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
            ],
        });
    });
});

describe("parses entity type then multiple modifiers won't double parse modifiers", () => {
    const filter = createDefaultedFilter({
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
    });

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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
            ],
        });
    });

    test("documents by john by me", () => {
        expect(parseSearchNaturalLanguageQuery("documents by john by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["by me"],
            controlQueryTexts: ["documents by john"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("documents by me by john", () => {
        expect(parseSearchNaturalLanguageQuery("documents by me by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["by john"],
            controlQueryTexts: ["documents by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                }),
            ],
        });
    });
});

describe("parses simpler entity type then multiple modifiers", () => {
    const filter = createDefaultedFilter({
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
    });

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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
            ],
        });
    });

    test("tasks by me yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks by me yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks by me yesterday"],
            filters: [
                createDefaultedFilter({
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
                }),
            ],
        });
    });

    test("tasks created by me yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks created by me yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks created by me yesterday"],
            filters: [
                createDefaultedFilter({
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
                }),
            ],
        });
    });

    test("tasks written by me yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks written by me yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks written by me yesterday"],
            filters: [
                createDefaultedFilter({
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
                }),
            ],
        });
    });

    test("tasks I updated yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks I updated yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks I updated yesterday"],
            filters: [
                createDefaultedFilter({
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
                }),
            ],
        });
    });

    test("tasks updated by me yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks updated by me yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks updated by me yesterday"],
            filters: [
                createDefaultedFilter({
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
                }),
            ],
        });
    });

    test("tasks john created yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks john created yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks john created yesterday"],
            filters: [
                createDefaultedFilter({
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
                }),
            ],
        });
    });

    test("tasks by john yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks by john yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks by john yesterday"],
            filters: [
                createDefaultedFilter({
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
                }),
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
                    createDefaultedFilter({
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
                    }),
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
                    createDefaultedFilter({
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
                    }),
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
                createDefaultedFilter({
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
                }),
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
                    createDefaultedFilter({
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
                    }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("messages from me last week", () => {
        expect(parseSearchNaturalLanguageQuery("messages from me last week", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from me last week"],
            filters: [
                createDefaultedFilter({
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
                }),
            ],
        });
    });

    test("messages from john last week", () => {
        expect(parseSearchNaturalLanguageQuery("messages from john last week", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["messages from john last week"],
            filters: [
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-01T13:50:03.726Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                }),
            ],
        });
    });

    test("documents i updated recently", () => {
        expect(parseSearchNaturalLanguageQuery("documents i updated recently", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["documents i updated recently"],
            filters: [
                createDefaultedFilter({
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
                }),
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
                createDefaultedFilter({
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
                }),
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
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("train all documents", () => {
        expect(parseSearchNaturalLanguageQuery("train all documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("all documents train", () => {
        expect(parseSearchNaturalLanguageQuery("all documents train", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("all documents about trains", () => {
        expect(parseSearchNaturalLanguageQuery("all documents about trains", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["all documents about"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });
});

describe('parses "all" with some text between then entity type', () => {
    test("all train documents", () => {
        expect(parseSearchNaturalLanguageQuery("all train documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all", "documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("all neat documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("all neat documents about georgia", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["neat", "georgia"],
            controlQueryTexts: ["all", "documents about"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("all train documents about georgia", () => {
        expect(
            parseSearchNaturalLanguageQuery("all train documents about georgia", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["train", "georgia"],
            controlQueryTexts: ["all", "documents about"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("all closed tasks", () => {
        expect(parseSearchNaturalLanguageQuery("all closed tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all", "closed tasks"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    openness: ["Closed"],
                }),
            ],
        });
    });

    test("all green documents", () => {
        expect(parseSearchNaturalLanguageQuery("all green documents", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["green"],
            controlQueryTexts: ["all", "documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("all the cat in the hat documents", () => {
        expect(
            parseSearchNaturalLanguageQuery("all the cat in the hat documents", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["the cat in the hat"],
            controlQueryTexts: ["all", "documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("all (the cat in the hat) documents", () => {
        expect(
            parseSearchNaturalLanguageQuery("all (the cat in the hat) documents", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: ["(the cat in the hat)"],
            controlQueryTexts: ["all", "documents"],
            filters: [createDefaultedFilter({entityTypes: ["Document"]})],
        });
    });

    test("all, the cat in the hat, chat messages", () => {
        expect(
            parseSearchNaturalLanguageQuery("all, the cat in the hat, chat messages", options),
        ).toEqual({
            isLowConfidence: true,
            queryTexts: ["all, the cat in the hat,"],
            controlQueryTexts: ["chat messages"],
            filters: [createDefaultedFilter({entityTypes: ["ChatMessage"]})],
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("all train documents by me", () => {
        expect(parseSearchNaturalLanguageQuery("all train documents by me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all", "documents by me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("all documents by john", () => {
        expect(parseSearchNaturalLanguageQuery("all documents by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["all documents by john"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("all train documents by john", () => {
        expect(parseSearchNaturalLanguageQuery("all train documents by john", options)).toEqual({
            isLowConfidence: false,
            queryTexts: ["train"],
            controlQueryTexts: ["all", "documents by john"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "MajorContributor",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
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
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("documents about my weekend plans - treats 'my' as regular text", () => {
            expect(
                parseSearchNaturalLanguageQuery("documents about my weekend plans", botOptions),
            ).toEqual({
                isLowConfidence: true,
                queryTexts: ["my weekend plans"],
                controlQueryTexts: ["documents about"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("my tasks - treats 'my' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("my tasks", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["my"],
                controlQueryTexts: ["tasks"],
                filters: [createDefaultedFilter({entityTypes: ["Task", "TaskCollection"]})],
            });
        });
    });

    describe('"me" keyword handling', () => {
        test("documents created by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents created by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["created by me"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("documents written by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents written by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["written by me"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("documents updated by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents updated by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["updated by me"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("documents by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["by me"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("messages sent by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("messages sent by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["sent by me"],
                controlQueryTexts: ["messages"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    }),
                ],
            });
        });

        test("posts authored by me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("posts authored by me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["authored by me"],
                controlQueryTexts: ["posts"],
                filters: [createDefaultedFilter({entityTypes: ["Post"]})],
            });
        });
    });

    describe('"I" keyword handling', () => {
        test("documents I created - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I created", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I created"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("documents I sent - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I sent", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I sent"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("documents I wrote - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I wrote", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I wrote"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("documents I authored - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I authored", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I authored"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("documents I updated - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("documents I updated", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I updated"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("messages I posted - treats 'I' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("messages I posted", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["I"],
                controlQueryTexts: ["messages", "posted"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    }),
                    createDefaultedFilter({entityTypes: ["Post"]}),
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
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("tasks about me - treats 'me' as regular text", () => {
            expect(parseSearchNaturalLanguageQuery("tasks about me", botOptions)).toEqual({
                isLowConfidence: true,
                queryTexts: ["me"],
                controlQueryTexts: ["tasks about"],
                filters: [createDefaultedFilter({entityTypes: ["Task", "TaskCollection"]})],
            });
        });

        test("documents containing I and me - treats both as regular text", () => {
            expect(
                parseSearchNaturalLanguageQuery("documents containing I and me", botOptions),
            ).toEqual({
                isLowConfidence: true,
                queryTexts: ["containing I and me"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
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
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                        },
                    }),
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
                    createDefaultedFilter({
                        entityTypes: ["Document"],
                        time: {
                            field: "Created",
                            range: {
                                inclusiveLowerBoundDate: new Date("2023-12-25T07:00:00.000Z"),
                                inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                            },
                        },
                    }),
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
                    createDefaultedFilter({
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
                    }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
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
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
                createDefaultedFilter({
                    entityTypes: ["Document"],
                    account: {
                        field: "Creator",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    // TODO: The following query should probably generate a filter with multiple acount
    // Ids.
    test.todo("documents created by john and me");

    // TODO: The following query should probably generate multiple filters
    test.todo("documents created by john or me");
});

describe("Due date filters", () => {
    test("tasks due today", () => {
        expect(parseSearchNaturalLanguageQuery("tasks due today", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks due today"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 4),
                            inclusiveLowerBound: new CalendarDate(2024, 1, 4),
                        },
                    },
                }),
            ],
        });
    });

    test("tasks due yesterday", () => {
        expect(parseSearchNaturalLanguageQuery("tasks due yesterday", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks due yesterday"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: new CalendarDate(2024, 1, 3),
                        },
                    },
                }),
            ],
        });
    });

    test("tasks due last week", () => {
        expect(parseSearchNaturalLanguageQuery("tasks due last week", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks due last week"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2023, 12, 31),
                            inclusiveLowerBound: new CalendarDate(2023, 12, 25),
                        },
                    },
                }),
            ],
        });
    });

    test("overdue tasks", () => {
        expect(parseSearchNaturalLanguageQuery("overdue tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["overdue tasks"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: null,
                        },
                    },
                }),
            ],
        });
    });

    // Alias for overdue
    test("late tasks", () => {
        expect(parseSearchNaturalLanguageQuery("late tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["late tasks"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: null,
                        },
                    },
                }),
            ],
        });
    });

    test("tasks that are late", () => {
        expect(parseSearchNaturalLanguageQuery("tasks that are late", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks that are late"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: null,
                        },
                    },
                }),
            ],
        });
    });
});

describe("Assignee filters", () => {
    test("tasks assigned to me", () => {
        expect(parseSearchNaturalLanguageQuery("tasks assigned to me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks assigned to me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("tasks assigned me", () => {
        expect(parseSearchNaturalLanguageQuery("tasks assigned me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks assigned me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("tasks assigned to John Smith", () => {
        expect(parseSearchNaturalLanguageQuery("tasks assigned to John Smith", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks assigned to John Smith"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("tasks assigned to Emily", () => {
        expect(parseSearchNaturalLanguageQuery("tasks assigned to Emily", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks assigned to Emily"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Assignee",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                }),
            ],
        });
    });
});

describe("Due date + Priority combinations", () => {
    test("urgent tasks due today", () => {
        expect(parseSearchNaturalLanguageQuery("urgent tasks due today", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["urgent tasks due today"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    priority: ["Urgent"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 4),
                            inclusiveLowerBound: new CalendarDate(2024, 1, 4),
                        },
                    },
                }),
            ],
        });
    });

    test("high priority overdue tasks", () => {
        expect(parseSearchNaturalLanguageQuery("high priority overdue tasks", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["high priority overdue tasks"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    priority: ["High"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: null,
                        },
                    },
                }),
            ],
        });
    });

    test("low priority tasks due last week", () => {
        expect(
            parseSearchNaturalLanguageQuery("low priority tasks due last week", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["low priority tasks due last week"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    priority: ["Low"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2023, 12, 31),
                            inclusiveLowerBound: new CalendarDate(2023, 12, 25),
                        },
                    },
                }),
            ],
        });
    });
});

describe("Assignee + Priority combinations", () => {
    test("urgent tasks assigned to me", () => {
        expect(parseSearchNaturalLanguageQuery("urgent tasks assigned to me", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["urgent tasks assigned to me"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    priority: ["Urgent"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("high priority tasks assigned to John Smith", () => {
        expect(
            parseSearchNaturalLanguageQuery("high priority tasks assigned to John Smith", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["high priority tasks assigned to John Smith"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    priority: ["High"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("tasks assigned to me that are urgent", () => {
        expect(
            parseSearchNaturalLanguageQuery("tasks assigned to me that are urgent", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks assigned to me that are urgent"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    priority: ["Urgent"],
                }),
            ],
        });
    });
});

describe("Assignee + Due date combinations", () => {
    test("tasks assigned to me due today", () => {
        expect(parseSearchNaturalLanguageQuery("tasks assigned to me due today", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks assigned to me due today"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 4),
                            inclusiveLowerBound: new CalendarDate(2024, 1, 4),
                        },
                    },
                }),
            ],
        });
    });

    test("overdue tasks assigned to John", () => {
        expect(parseSearchNaturalLanguageQuery("overdue tasks assigned to John", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["overdue tasks assigned to John"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: null,
                        },
                    },
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("tasks assigned to me that are overdue", () => {
        expect(
            parseSearchNaturalLanguageQuery("tasks assigned to me that are overdue", options),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks assigned to me that are overdue"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: null,
                        },
                    },
                }),
            ],
        });
    });

    test("my tasks due this week", () => {
        expect(parseSearchNaturalLanguageQuery("my tasks due this week", options)).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["my tasks due this week"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "MajorContributor",
                        accounts: [
                            {
                                id: options.actorAccount.id,
                                name: options.actorAccount.name,
                            },
                        ],
                    },
                    date: {
                        field: "Due",
                        range: {
                            inclusiveLowerBound: new CalendarDate(2024, 1, 1),
                            inclusiveUpperBound: new CalendarDate(2024, 1, 7),
                        },
                    },
                }),
            ],
        });
    });
});

// Generate a bunch of tests to make sure our modifiers for tasks work as expected
// Not all entity types support these modifiers, so we just choose tasks for these
// tests You should rely on other tests to verify modifiers for other entity types

// Running all test cases takes an extra ~30s in our CI, so let's randomly pair it
// down to a smaller subset. If you encounter an error in CI but not locally, bump
// this up to 1 to run all tests in the suite.
const generatedTaskModifierTestRunPercent = 0.25;
describe("Generated task modifiers tests", () => {
    const opennessTestCases = {
        Open: ["open", "pending", "todo", "not closed", "not done"],
        Closed: ["closed", "done", "finished", "resolved", "fixed", "not open"],
    };

    const activenessTestCases = {
        Active: ["active", "started", "ongoing", "not inactive"],
        Inactive: ["inactive", "not active", "not started"],
    };

    const priorityTestCases = {
        Urgent: ["urgent"],
        High: ["high"],
        Medium: ["medium"],
        Low: ["low"],
    };

    const dueTestCases = {
        Overdue: ["overdue", "late"],
    };

    const johnsAccount = accounts[1]!;
    const assignedTestCases = {
        Assigned: ["assigned to John", "assignee John"],
    };

    function getFilterTestCases<const T extends Record<string, ReadonlyArray<string>>>(
        fieldTestCases: T,
    ): Array<{filter: keyof T & string; adjective: string} | null> {
        const testCases: Array<{filter: keyof T & string; adjective: string} | null> = [];

        for (const [filter, adjectives] of Object.entries(fieldTestCases)) {
            for (const adjective of adjectives) {
                testCases.push({
                    filter: filter as keyof T & string,
                    adjective: adjective,
                });
            }
        }

        testCases.push(null);

        return testCases;
    }

    function createQuery(
        numberOfAdjectivesPrefixed: number,
        adjectives: Array<string>,
        onlyAfterAdjectives: Array<string>,
    ) {
        const noun = "tasks";

        // sort them in a predictable way so we run the same tests each time, but the same
        // words aren't always at the beginning (i.e. "active")
        const sortedAdjectives = adjectives.sort((a, b) =>
            adjectives.length % 2 === 0 ? a.localeCompare(b) : b.localeCompare(a),
        );
        const adjectivesBefore = sortedAdjectives.slice(0, numberOfAdjectivesPrefixed);
        const adjectivesAfter = sortedAdjectives
            .slice(numberOfAdjectivesPrefixed)
            .concat(onlyAfterAdjectives);

        let adjectivesBeforeString = "";
        for (let i = 0; i < adjectivesBefore.length; i++) {
            adjectivesBeforeString += adjectivesBefore[i];
            if (i < adjectivesBefore.length - 1) {
                // pseudo-randomly insert "and"
                adjectivesBeforeString += i % 2 === 0 ? " and " : " ";
            }
        }

        let adjectivesAfterString = "";
        for (let i = 0; i < adjectivesAfter.length; i++) {
            adjectivesAfterString += adjectivesAfter[i];
            if (i < adjectivesAfter.length - 1) {
                // pseudo-randomly insert "that"
                adjectivesAfterString += i % 3 === 1 ? " and that are " : " and ";
            }
        }

        let query = noun;
        if (adjectivesBeforeString) {
            query = `${adjectivesBeforeString} ${noun}`;
        }

        if (adjectivesAfterString) {
            query = `${query} that are ${adjectivesAfterString}`;
        }

        return query;
    }

    function runTest(
        query: string,
        {
            openness,
            activeness,
            priority,
            due,
            assigned,
        }: {
            openness: keyof typeof opennessTestCases | null;
            activeness: keyof typeof activenessTestCases | null;
            priority: keyof typeof priorityTestCases | null;
            due: keyof typeof dueTestCases | null;
            assigned: keyof typeof assignedTestCases | null;
        },
    ) {
        test(`generated "${query}"`, () => {
            const date: SearchNaturalLanguageFilter["date"] =
                due === "Overdue"
                    ? {
                          field: "Due",
                          range: {
                              inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                              inclusiveLowerBound: null,
                          },
                      }
                    : null;

            const account: SearchNaturalLanguageFilter["account"] =
                assigned === "Assigned"
                    ? {
                          field: "Assignee",
                          accounts: [{id: johnsAccount.id, name: johnsAccount.initialData.name}],
                      }
                    : null;

            expect(parseSearchNaturalLanguageQuery(query, options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: [query],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        activeness: activeness ? [activeness] : null,
                        priority: priority ? [priority] : null,
                        openness: openness ? [openness] : null,
                        date,
                        account,
                    }),
                ],
            });
        });
    }

    for (const openness of getFilterTestCases(opennessTestCases)) {
        for (const activeness of getFilterTestCases(activenessTestCases)) {
            for (const priority of getFilterTestCases(priorityTestCases)) {
                for (const due of getFilterTestCases(dueTestCases)) {
                    for (const assigned of getFilterTestCases(assignedTestCases)) {
                        const enabledFilters = [openness, activeness, priority, due].filter(
                            s => s !== null,
                        );

                        if (enabledFilters.length === 0) continue;

                        // Create queries with variations of filters being applied before/after
                        const queries = Array.from({length: enabledFilters.length + 1}, (_, i) =>
                            createQuery(
                                i,
                                enabledFilters.map(f => f.adjective),
                                assigned ? [assigned.adjective] : [],
                            ),
                        );

                        for (const query of queries) {
                            if (Math.random() > generatedTaskModifierTestRunPercent) continue;

                            runTest(query, {
                                openness: openness?.filter ?? null,
                                activeness: activeness?.filter ?? null,
                                priority: priority?.filter ?? null,
                                due: due?.filter ?? null,
                                assigned: assigned?.filter ?? null,
                            });
                        }
                    }
                }
            }
        }
    }
});

describe("Modifiers before search entity", () => {
    describe("Activity: active/inactive", () => {
        test("active tasks", () => {
            expect(parseSearchNaturalLanguageQuery("active tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["active tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("all active tasks", () => {
            expect(parseSearchNaturalLanguageQuery("all active tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["all", "active tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("my active tasks", () => {
            expect(parseSearchNaturalLanguageQuery("my active tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["my", "active tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        activeness: ["Active"],
                    }),
                ],
            });
        });
    });

    describe("Priority: urgent/high/medium/low", () => {
        test("high priority tasks", () => {
            expect(parseSearchNaturalLanguageQuery("high priority tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["high priority tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High"],
                    }),
                ],
            });
        });

        // Alias for priority
        test("high severity tasks", () => {
            expect(parseSearchNaturalLanguageQuery("high severity tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["high severity tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High"],
                    }),
                ],
            });
        });

        test("my high priority tasks", () => {
            expect(parseSearchNaturalLanguageQuery("my high priority tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["my", "high priority tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        priority: ["High"],
                    }),
                ],
            });
        });
    });

    describe("Combined modifiers", () => {
        test("high priority and active tasks", () => {
            expect(
                parseSearchNaturalLanguageQuery("high priority and active tasks", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["high priority and active tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("open and active and important tasks", () => {
            expect(
                parseSearchNaturalLanguageQuery("open and active and important tasks", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["open and active and important tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent", "High"],
                        openness: ["Open"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("important tasks that are open", () => {
            expect(
                parseSearchNaturalLanguageQuery("important tasks that are open", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["important tasks that are open"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent", "High"],
                        openness: ["Open"],
                    }),
                ],
            });
        });

        test("low priority and urgent tasks", () => {
            expect(
                parseSearchNaturalLanguageQuery("low priority and urgent tasks", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["low priority and urgent tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Low", "Urgent"],
                    }),
                ],
            });
        });
    });

    describe("Modifiers on non-supporting entities should be query text", () => {
        test("high altitude documents - 'high' should be query text", () => {
            expect(parseSearchNaturalLanguageQuery("high altitude documents", options)).toEqual({
                isLowConfidence: true,
                queryTexts: ["high altitude"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("high priority documents - 'high priority' should be query text", () => {
            expect(parseSearchNaturalLanguageQuery("high priority documents", options)).toEqual({
                isLowConfidence: true,
                queryTexts: ["high priority"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("high priority - 'high priority' should be query text when no entity", () => {
            expect(parseSearchNaturalLanguageQuery("high priority", options)).toEqual({
                isLowConfidence: false,
                queryTexts: ["high priority"],
                controlQueryTexts: [],
                filters: [],
            });
        });

        test("active documents - 'active' should be query text", () => {
            expect(parseSearchNaturalLanguageQuery("active documents", options)).toEqual({
                isLowConfidence: true,
                queryTexts: ["active"],
                controlQueryTexts: ["documents"],
                filters: [createDefaultedFilter({entityTypes: ["Document"]})],
            });
        });

        test("closed posts - 'closed' should be query text", () => {
            expect(parseSearchNaturalLanguageQuery("closed posts", options)).toEqual({
                isLowConfidence: true,
                queryTexts: ["closed"],
                controlQueryTexts: ["posts"],
                filters: [createDefaultedFilter({entityTypes: ["Post"]})],
            });
        });

        test("open channels - 'open' should be query text", () => {
            expect(parseSearchNaturalLanguageQuery("open channels", options)).toEqual({
                isLowConfidence: true,
                queryTexts: ["open"],
                controlQueryTexts: ["channels"],
                filters: [createDefaultedFilter({entityTypes: ["Channel"]})],
            });
        });

        test("open urgent and tasks - 'open urgent' should be query text with 'and' before tasks", () => {
            expect(parseSearchNaturalLanguageQuery("open urgent and tasks", options)).toEqual({
                isLowConfidence: true,
                queryTexts: ["open urgent and"],
                controlQueryTexts: ["tasks"],
                filters: [createDefaultedFilter({entityTypes: ["Task", "TaskCollection"]})],
            });
        });
    });

    describe("Single priority modifiers", () => {
        test("urgent tasks", () => {
            expect(parseSearchNaturalLanguageQuery("urgent tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["urgent tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                    }),
                ],
            });
        });

        test("critical tasks", () => {
            expect(parseSearchNaturalLanguageQuery("critical tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["critical tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent", "High"],
                    }),
                ],
            });
        });

        test("medium priority tasks", () => {
            expect(parseSearchNaturalLanguageQuery("medium priority tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["medium priority tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Medium"],
                    }),
                ],
            });
        });

        test("low priority tasks", () => {
            expect(parseSearchNaturalLanguageQuery("low priority tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["low priority tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Low"],
                    }),
                ],
            });
        });
    });

    describe("Openness + Priority combinations", () => {
        test("open urgent tasks", () => {
            expect(parseSearchNaturalLanguageQuery("open urgent tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["open urgent tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                        openness: ["Open"],
                    }),
                ],
            });
        });

        test("closed high priority tasks", () => {
            expect(parseSearchNaturalLanguageQuery("closed high priority tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["closed high priority tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High"],
                        openness: ["Closed"],
                    }),
                ],
            });
        });

        test("high priority open tasks", () => {
            expect(parseSearchNaturalLanguageQuery("high priority open tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["high priority open tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High"],
                        openness: ["Open"],
                    }),
                ],
            });
        });
    });

    describe("Activeness + Priority combinations", () => {
        test("active urgent tasks", () => {
            expect(parseSearchNaturalLanguageQuery("active urgent tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["active urgent tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("inactive low priority tasks", () => {
            expect(parseSearchNaturalLanguageQuery("inactive low priority tasks", options)).toEqual(
                {
                    isLowConfidence: false,
                    queryTexts: [],
                    controlQueryTexts: ["inactive low priority tasks"],
                    filters: [
                        createDefaultedFilter({
                            entityTypes: ["Task", "TaskCollection"],
                            priority: ["Low"],
                            activeness: ["Inactive"],
                        }),
                    ],
                },
            );
        });

        test("high priority inactive tasks", () => {
            expect(
                parseSearchNaturalLanguageQuery("high priority inactive tasks", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["high priority inactive tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High"],
                        activeness: ["Inactive"],
                    }),
                ],
            });
        });
    });

    describe("All three task modifiers combined", () => {
        test("open active urgent tasks", () => {
            expect(parseSearchNaturalLanguageQuery("open active urgent tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["open active urgent tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                        openness: ["Open"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("urgent open and active tasks", () => {
            expect(
                parseSearchNaturalLanguageQuery("urgent open and active tasks", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["urgent open and active tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                        openness: ["Open"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("high priority closed inactive tasks", () => {
            expect(
                parseSearchNaturalLanguageQuery("high priority closed inactive tasks", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["high priority closed inactive tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High"],
                        openness: ["Closed"],
                        activeness: ["Inactive"],
                    }),
                ],
            });
        });
    });

    describe("'that are' forward modifier patterns", () => {
        test("urgent tasks that are active", () => {
            expect(
                parseSearchNaturalLanguageQuery("urgent tasks that are active", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["urgent tasks that are active"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("high priority tasks that are open", () => {
            expect(
                parseSearchNaturalLanguageQuery("high priority tasks that are open", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["high priority tasks that are open"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High"],
                        openness: ["Open"],
                    }),
                ],
            });
        });

        test("open tasks that are active", () => {
            expect(parseSearchNaturalLanguageQuery("open tasks that are active", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["open tasks that are active"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        openness: ["Open"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("tasks that are urgent and active", () => {
            expect(
                parseSearchNaturalLanguageQuery("tasks that are urgent and active", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["tasks that are urgent and active"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        // missing "are" still parses modifiers for fast typers who omit "are"
        test("tasks that urgent and active", () => {
            expect(
                parseSearchNaturalLanguageQuery("tasks that urgent and active", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["tasks that urgent and active"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("urgent tasks that are open and active", () => {
            expect(
                parseSearchNaturalLanguageQuery("urgent tasks that are open and active", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["urgent tasks that are open and active"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                        openness: ["Open"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });
    });

    describe("Date modifiers with priority/openness/activeness", () => {
        test("tasks created today", () => {
            expect(parseSearchNaturalLanguageQuery("tasks created today", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["tasks created today"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        time: {
                            field: "Created",
                            range: {
                                // "today" gets some slop duration added
                                inclusiveUpperBoundDate: new Date("2024-01-05T06:59:59.999Z"),
                                inclusiveLowerBoundDate: new Date("2024-01-04T07:00:00.000Z"),
                            },
                        },
                    }),
                ],
            });
        });

        test("urgent tasks created today", () => {
            expect(parseSearchNaturalLanguageQuery("urgent tasks created today", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["urgent tasks created today"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        time: {
                            field: "Created",
                            range: {
                                inclusiveUpperBoundDate: new Date("2024-01-05T06:59:59.999Z"),
                                inclusiveLowerBoundDate: new Date("2024-01-04T07:00:00.000Z"),
                            },
                        },
                        priority: ["Urgent"],
                    }),
                ],
            });
        });

        test("high priority active tasks created today", () => {
            expect(
                parseSearchNaturalLanguageQuery(
                    "high priority active tasks created today",
                    options,
                ),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["high priority active tasks created today"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        time: {
                            field: "Created",
                            range: {
                                inclusiveUpperBoundDate: new Date("2024-01-05T06:59:59.999Z"),
                                inclusiveLowerBoundDate: new Date("2024-01-04T07:00:00.000Z"),
                            },
                        },
                        priority: ["High"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });
    });

    describe("Account + modifiers combinations", () => {
        test("my urgent tasks", () => {
            expect(parseSearchNaturalLanguageQuery("my urgent tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["my", "urgent tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        priority: ["Urgent"],
                    }),
                ],
            });
        });

        test("my open active tasks", () => {
            expect(parseSearchNaturalLanguageQuery("my open active tasks", options)).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["my", "open active tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        openness: ["Open"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("my high priority open active tasks", () => {
            expect(
                parseSearchNaturalLanguageQuery("my high priority open active tasks", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["my", "high priority open active tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        priority: ["High"],
                        openness: ["Open"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("tasks created by me that are urgent", () => {
            expect(
                parseSearchNaturalLanguageQuery("tasks created by me that are urgent", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["tasks created by me that are urgent"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "Creator",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        priority: ["Urgent"],
                    }),
                ],
            });
        });
    });

    describe("Query text with modifiers", () => {
        test("urgent tasks about trains", () => {
            expect(parseSearchNaturalLanguageQuery("urgent tasks about trains", options)).toEqual({
                isLowConfidence: false,
                queryTexts: ["trains"],
                controlQueryTexts: ["urgent tasks about"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent"],
                    }),
                ],
            });
        });

        test("high priority active tasks about trains", () => {
            expect(
                parseSearchNaturalLanguageQuery("high priority active tasks about trains", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: ["trains"],
                controlQueryTexts: ["high priority active tasks about"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High"],
                        activeness: ["Active"],
                    }),
                ],
            });
        });

        test("tasks about trains that are urgent", () => {
            // Note: "about" breaks the forward modifier parsing, so "that are urgent" becomes
            // query text
            expect(
                parseSearchNaturalLanguageQuery("tasks about trains that are urgent", options),
            ).toEqual({
                isLowConfidence: true,
                queryTexts: ["trains that are urgent"],
                controlQueryTexts: ["tasks about"],
                filters: [createDefaultedFilter({entityTypes: ["Task", "TaskCollection"]})],
            });
        });

        test("my urgent tasks about machine learning", () => {
            expect(
                parseSearchNaturalLanguageQuery("my urgent tasks about machine learning", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: ["machine learning"],
                controlQueryTexts: ["my", "urgent tasks about"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        priority: ["Urgent"],
                    }),
                ],
            });
        });
    });

    describe("Complex combinations", () => {
        test("my urgent open tasks created today about trains", () => {
            // Note: With the LR(n) parser, prefix modifiers like "urgent open" ARE now
            // captured before the entity type "tasks", making this parse more complete
            expect(
                parseSearchNaturalLanguageQuery(
                    "my urgent open tasks created today about trains",
                    options,
                ),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: ["trains"],
                controlQueryTexts: ["my", "urgent open tasks created today about"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        account: {
                            field: "MajorContributor",
                            accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                        },
                        priority: ["Urgent"],
                        openness: ["Open"],
                        time: {
                            field: "Created",
                            range: {
                                inclusiveUpperBoundDate: new Date("2024-01-05T06:59:59.999Z"),
                                inclusiveLowerBoundDate: new Date("2024-01-04T07:00:00.000Z"),
                            },
                        },
                    }),
                ],
            });
        });

        test("high priority and medium priority tasks", () => {
            expect(
                parseSearchNaturalLanguageQuery("high priority and medium priority tasks", options),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["high priority and medium priority tasks"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["High", "Medium"],
                    }),
                ],
            });
        });

        test("important and urgent tasks that are open", () => {
            // When parsing forward with the LR(n) parser: "important" → ["Urgent", "High"],
            // then "urgent" → already has "Urgent" so only adds nothing Result is ["Urgent",
            // "High"] in the order they were encountered
            expect(
                parseSearchNaturalLanguageQuery(
                    "important and urgent tasks that are open",
                    options,
                ),
            ).toEqual({
                isLowConfidence: false,
                queryTexts: [],
                controlQueryTexts: ["important and urgent tasks that are open"],
                filters: [
                    createDefaultedFilter({
                        entityTypes: ["Task", "TaskCollection"],
                        priority: ["Urgent", "High"],
                        openness: ["Open"],
                    }),
                ],
            });
        });
    });
});

describe("Complex combinations with all filters", () => {
    test("tasks assigned to me that are urgent and open and due today", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "tasks assigned to me that are urgent and open and due today",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["tasks assigned to me that are urgent and open and due today"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    priority: ["Urgent"],
                    openness: ["Open"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 4),
                            inclusiveLowerBound: new CalendarDate(2024, 1, 4),
                        },
                    },
                }),
            ],
        });
    });

    test("tasks that are low priority and open and due today assigned to John", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "tasks that are low priority and open and due today assigned to John",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: [
                "tasks that are low priority and open and due today assigned to John",
            ],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    priority: ["Low"],
                    openness: ["Open"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 4),
                            inclusiveLowerBound: new CalendarDate(2024, 1, 4),
                        },
                    },
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                }),
            ],
        });
    });

    test("high priority active overdue tasks assigned to Emily", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "high priority active overdue tasks assigned to Emily",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["high priority active overdue tasks assigned to Emily"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    priority: ["High"],
                    activeness: ["Active"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: null,
                        },
                    },
                    account: {
                        field: "Assignee",
                        accounts: [
                            {id: accounts[2]!.id, name: accounts[2]!.initialData.name},
                            {id: accounts[4]!.id, name: accounts[4]!.initialData.name},
                        ],
                    },
                }),
            ],
        });
    });

    test("important overdue tasks assigned to me that are active", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "important overdue tasks assigned to me that are active",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["important overdue tasks assigned to me that are active"],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    priority: ["Urgent", "High"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: null,
                        },
                    },
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[0]!.id, name: accounts[0]!.initialData.name}],
                    },
                    activeness: ["Active"],
                }),
            ],
        });
    });

    test("tasks assigned to John Smith that are high priority and closed and due yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "tasks assigned to John Smith that are high priority and closed and due yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: [
                "tasks assigned to John Smith that are high priority and closed and due yesterday",
            ],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    priority: ["High"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: new CalendarDate(2024, 1, 3),
                        },
                    },
                    openness: ["Closed"],
                }),
            ],
        });
    });

    test("high priority and closed tasks assigned to John Smith that are due by yesterday", () => {
        expect(
            parseSearchNaturalLanguageQuery(
                "high priority and closed tasks assigned to John Smith that are due by yesterday",
                options,
            ),
        ).toEqual({
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: [
                "high priority and closed tasks assigned to John Smith that are due by yesterday",
            ],
            filters: [
                createDefaultedFilter({
                    entityTypes: ["Task", "TaskCollection"],
                    account: {
                        field: "Assignee",
                        accounts: [{id: accounts[1]!.id, name: accounts[1]!.initialData.name}],
                    },
                    priority: ["High"],
                    date: {
                        field: "Due",
                        range: {
                            inclusiveUpperBound: new CalendarDate(2024, 1, 3),
                            inclusiveLowerBound: new CalendarDate(2024, 1, 3),
                        },
                    },
                    openness: ["Closed"],
                }),
            ],
        });
    });
});
