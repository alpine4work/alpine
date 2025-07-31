/* eslint-disable string-quotes */

import _Fuse from "fuse.js";
import {parseSearchNaturalLanguageQuery} from "~/server/search/data/index/internal/parse_search_natural_language_query.js";
import {
    accountNameIndexFuseMinMatchCharLength,
    accountNameIndexFuseScoreMatchCutoff,
} from "~/server/spaces/spaces_table.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

// Node.js ESM interop (#node-esm-migration)
type Fuse<T> = _Fuse.default<T>;
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

const createdTime = new Date();

const accounts = [
    new AccountModel({
        id: generateId(),
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
    new AccountModel({
        id: generateId(),
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
    new AccountModel({
        id: generateId(),
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
    new AccountModel({
        id: generateId(),
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
    new AccountModel({
        id: generateId(),
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

    actorAccountId: accounts[0]!.id,
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
    },
};

test("parses search entity type then account name", () => {
    expect(parseSearchNaturalLanguageQuery("documents by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents by me about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("train documents by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents by john about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents by john trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents by john smith", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents by john smith"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("trains1 documents by john trains2", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains1", "trains2"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("messages from emily", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["messages from emily"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                account: {
                    field: "MajorContributor",
                    ids: [accounts[2]!.id, accounts[4]!.id],
                },
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("comments from emily", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["comments from emily"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                account: {
                    field: "MajorContributor",
                    ids: [accounts[2]!.id, accounts[4]!.id],
                },
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("post comments from emily", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["post comments from emily"],
        filters: [
            {
                entityTypes: ["PostComment"],
                account: {
                    field: "MajorContributor",
                    ids: [accounts[2]!.id, accounts[4]!.id],
                },
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("messages from emily smith", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["messages from emily smith"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                account: {field: "MajorContributor", ids: [accounts[2]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("messages from emily lin", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["messages from emily lin"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                account: {field: "MajorContributor", ids: [accounts[4]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("messeges from emily", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["messeges from emily"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                account: {
                    field: "MajorContributor",
                    ids: [accounts[2]!.id, accounts[4]!.id],
                },
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("messsegees from emily", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["messsegees from emily"],
        controlQueryTexts: [],
        filters: [],
    });

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

test("parses search entity type then relationship then me", () => {
    expect(parseSearchNaturalLanguageQuery("documents created by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents created by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents created by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents created by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents created by me about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents created by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents written by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents written by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents written by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents written by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents written by me about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents written by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents updated by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents updated by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents updated by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents updated by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents updated by me about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents updated by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents udpated by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents udpated by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents udpated by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents udpated by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents udpated by me about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents udpated by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });
});

test("parses search entity type then relationship then account name", () => {
    expect(parseSearchNaturalLanguageQuery("documents created by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents created by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents created by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents created by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents created by john trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents created by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents created by john smith", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents created by john smith"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents created by john about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents created by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents written by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents written by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents written by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents written by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents written by john about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents written by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents updated by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents updated by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents updated by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents updated by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents updated by john about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents updated by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("documents udpated by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents udpated by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents udpated by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents udpated by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents udpated by john about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents udpated by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });
});

test("parses search entity type then I then relationship", () => {
    expect(parseSearchNaturalLanguageQuery("documents I created", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents I created"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents I created", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents I created"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents I created about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents I created about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents I wrote", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents I wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents I wrote", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents I wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents I wrote about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents I wrote about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents I updated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents I updated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents I updated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents I updated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents I updated about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents I updated about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents I udpated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents I udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents I udpated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents I udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents I udpated about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents I udpated about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });
});

test("parses search entity type then account first name then relationship", () => {
    expect(parseSearchNaturalLanguageQuery("documents john created", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents john created"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents john created", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents john created"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents john created about trains", options)).toEqual(
        {
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john created about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {field: "Creator", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseSearchNaturalLanguageQuery("documents john wrote", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents john wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents john wrote", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents john wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents john wrote about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john wrote about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents john updated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents john updated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents john updated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents john updated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents john updated about trains", options)).toEqual(
        {
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john updated about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseSearchNaturalLanguageQuery("documents john udpated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents john udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents john udpated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents john udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents john udpated about trains", options)).toEqual(
        {
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["documents john udpated about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );
});

test("parses search entity type then account full name then relationship", () => {
    expect(parseSearchNaturalLanguageQuery("documents john smith created", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents john smith created"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents john smith created", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents john smith created"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents john smith created about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john smith created about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents john smith wrote", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents john smith wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents john smith wrote", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents john smith wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents john smith wrote about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john smith wrote about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents john smith updated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents john smith updated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents john smith updated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents john smith updated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents john smith updated about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john smith updated about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents john smith udpated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents john smith udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("train documents john smith udpated", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["documents john smith udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents john smith udpated about trains", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john smith udpated about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });
});

test("parses account name then entity type", () => {
    expect(parseSearchNaturalLanguageQuery("my documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["my documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("train my documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["my documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("my documents train", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["my documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("my documents about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["my documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john's documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["john's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("train john's documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["john's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john's documents train", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["john's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john's documents about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["john's documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john smith's documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["john smith's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("train john smith's documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["john smith's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john smith's documents train", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["john smith's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john smith's documents about trains", options)).toEqual(
        {
            isLowConfidence: false,
            queryTexts: ["trains"],
            controlQueryTexts: ["john smith's documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseSearchNaturalLanguageQuery("johns documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["johns documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("train johns documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["johns documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("johns documents train", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["johns documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("johns documents about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["johns documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john smiths documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["john smiths documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("train john smiths documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["john smiths documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john smiths documents train", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["john smiths documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john smiths documents about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["john smiths documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["john"],
        controlQueryTexts: [],
        filters: [],
    });

    expect(parseSearchNaturalLanguageQuery("john smith", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["john smith"],
        controlQueryTexts: [],
        filters: [],
    });

    expect(parseSearchNaturalLanguageQuery("johna documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["johna documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("johna's documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["johna's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("all of my documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["all of my documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("all of john's documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["all of john's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("all of my train documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["all of my", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("all of john's train documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["all of john's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("all of documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["all of documents"],
        controlQueryTexts: [],
        filters: [],
    });
});

test("parses account name with some text between then entity type", () => {
    expect(parseSearchNaturalLanguageQuery("my train documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["my", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john's train documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["john's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john smith's train documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["john smith's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("my neat documents about georgia", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["neat", "georgia"],
        controlQueryTexts: ["my", "documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
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
    expect(parseSearchNaturalLanguageQuery("john's neat documents about georgia", options)).toEqual(
        {
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
        },
    );

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

    expect(parseSearchNaturalLanguageQuery("my train documents about georgia", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train", "georgia"],
        controlQueryTexts: ["my", "documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("john's train documents about georgia", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["train", "georgia"],
        controlQueryTexts: ["john's", "documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("john smith's train documents about georgia", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["train", "georgia"],
        controlQueryTexts: ["john smith's", "documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("my closed tasks", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["closed"],
        controlQueryTexts: ["my", "tasks"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

    expect(parseSearchNaturalLanguageQuery("my green documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["green"],
        controlQueryTexts: ["my", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john's green documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["green"],
        controlQueryTexts: ["john's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john smith's green documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["green"],
        controlQueryTexts: ["john smith's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john's smith documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["john's smith documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("my the cat in the hat documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["the cat in the hat"],
        controlQueryTexts: ["my", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("john's the cat in the hat documents", options)).toEqual(
        {
            isLowConfidence: false,
            queryTexts: ["the cat in the hat"],
            controlQueryTexts: ["john's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(
        parseSearchNaturalLanguageQuery("john smith's the cat in the hat documents", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["the cat in the hat"],
        controlQueryTexts: ["john smith's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("my (the cat in the hat) documents", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["(the cat in the hat)"],
        controlQueryTexts: ["my", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("john's (the cat in the hat) documents", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["(the cat in the hat)"],
        controlQueryTexts: ["john's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseSearchNaturalLanguageQuery("john smith's (the cat in the hat) documents", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["(the cat in the hat)"],
        controlQueryTexts: ["john smith's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

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

    expect(
        parseSearchNaturalLanguageQuery("john smith's, the cat in the hat, chat messages", options),
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

test("parses standalone entity type", () => {
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

test("correctly splits query texts", () => {
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

test("provides duration slop when referencing precise date", () => {
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

    expect(parseSearchNaturalLanguageQuery("documents created 2 minutes ago", options)).toEqual({
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
    });

    expect(parseSearchNaturalLanguageQuery("documents created 5 minutes ago", options)).toEqual({
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
    });

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

test("parses entity type then date field then date", () => {
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

    expect(parseSearchNaturalLanguageQuery("documents last updated 2 weeks ago", options)).toEqual({
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

    expect(parseSearchNaturalLanguageQuery("documents last udpated 2 weeks ago", options)).toEqual({
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

    expect(parseSearchNaturalLanguageQuery("documents updated after 2 weeks ago", options)).toEqual(
        {
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
        },
    );

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

test("parses entity type then multiple modifiers", () => {
    const filter = {
        entityTypes: ["Document"],
        account: {field: "Creator", ids: [accounts[0]!.id]},
        time: {
            field: "Created",
            range: {
                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
            },
        },
    };

    expect(
        parseSearchNaturalLanguageQuery("documents created by me and created yesterday", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents created by me and created yesterday"],
        filters: [filter],
    });

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

    expect(
        parseSearchNaturalLanguageQuery("documents created by me created yesterday", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents created by me created yesterday"],
        filters: [filter],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents created yesterday and created by me", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents created yesterday and created by me"],
        filters: [filter],
    });

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

    expect(
        parseSearchNaturalLanguageQuery("documents created yesterday created by me", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents created yesterday created by me"],
        filters: [filter],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents written by me and created yesterday", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents written by me and created yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
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

    expect(
        parseSearchNaturalLanguageQuery("documents updated by me and created yesterday", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents updated by me and created yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
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

    expect(
        parseSearchNaturalLanguageQuery("documents written yesterday and created by me", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents written yesterday and created by me"],
        filters: [filter],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents updated yesterday and created by me", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents updated yesterday and created by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
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

test("parses entity type then multiple modifiers won't double parse modifiers", () => {
    const filter = {
        entityTypes: ["Document"],
        account: {field: "Creator", ids: [accounts[0]!.id]},
        time: {
            field: "Created",
            range: {
                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
            },
        },
    };

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
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
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
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
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
                account: {field: "Creator", ids: [accounts[0]!.id]},
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
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
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
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
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
                account: {field: "Creator", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("documents by john by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["by me"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("documents by me by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["by john"],
        controlQueryTexts: ["documents by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

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

test("parses simpler entity type then multiple modifiers", () => {
    const filter = {
        entityTypes: ["Document"],
        account: {field: "MajorContributor", ids: [accounts[0]!.id]},
        time: {
            field: "Created",
            range: {
                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
            },
        },
    };

    expect(parseSearchNaturalLanguageQuery("documents by me created yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents by me created yesterday"],
        filters: [filter],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents by me that were created yesterday", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents by me that were created yesterday"],
        filters: [filter],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents from me that were created yesterday", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents from me that were created yesterday"],
        filters: [filter],
    });

    expect(
        parseSearchNaturalLanguageQuery("documents from yesterday that I created", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents from yesterday that I created"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("documents I created from yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents I created from yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
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

test("parses entity type then account then shortcuts to time", () => {
    expect(parseSearchNaturalLanguageQuery("tasks I created yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks I created yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks by me yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks by me yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks created by me yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks created by me yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks written by me yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks written by me yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks I updated yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks I updated yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks updated by me yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks updated by me yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks john created yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks john created yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks by john yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks by john yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks created by john yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks created by john yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "Creator", ids: [accounts[1]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks written by john yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks written by john yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks john updated yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks john updated yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks updated by john yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks updated by john yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "AnyContributor", ids: [accounts[1]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("tasks I created before yesterday", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["tasks I created before yesterday"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
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

    expect(
        parseSearchNaturalLanguageQuery("tasks I created before and created yesterday", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["before and created yesterday"],
        controlQueryTexts: ["tasks I created"],
        filters: [
            {
                entityTypes: ["Task", "TaskCollection"],
                account: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("messages from me last week", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["messages from me last week"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("messages from john last week", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["messages from john last week"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
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

test("parses date modifier after account name then entity type", () => {
    expect(parseSearchNaturalLanguageQuery("my documents created two days ago", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["my documents created two days ago"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
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

    expect(
        parseSearchNaturalLanguageQuery("john's documents created two days ago", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["john's documents created two days ago"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
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

    expect(
        parseSearchNaturalLanguageQuery("my green documents created two days ago", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["green"],
        controlQueryTexts: ["my", "documents created two days ago"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
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

    expect(
        parseSearchNaturalLanguageQuery("john's green documents created two days ago", options),
    ).toEqual({
        isLowConfidence: false,
        queryTexts: ["green"],
        controlQueryTexts: ["john's", "documents created two days ago"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
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

test('parses the word "recently" in dates', () => {
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

    expect(parseSearchNaturalLanguageQuery("documents i updated recently", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["documents i updated recently"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "AnyContributor", ids: [accounts[0]!.id]},
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

    expect(parseSearchNaturalLanguageQuery("chat messages sent recently by john", options)).toEqual(
        {
            isLowConfidence: false,
            queryTexts: [],
            controlQueryTexts: ["chat messages sent recently by john"],
            filters: [
                {
                    entityTypes: ["ChatMessage"],
                    account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-01T13:50:03.726Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                },
            ],
        },
    );
});

test('parses "all" then entity type', () => {
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

test('parses "all" with some text between then entity type', () => {
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

    expect(parseSearchNaturalLanguageQuery("all neat documents about georgia", options)).toEqual({
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

    expect(parseSearchNaturalLanguageQuery("all train documents about georgia", options)).toEqual({
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

    expect(parseSearchNaturalLanguageQuery("all the cat in the hat documents", options)).toEqual({
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

    expect(parseSearchNaturalLanguageQuery("all (the cat in the hat) documents", options)).toEqual({
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

test('parses date modifier after "all" then entity type', () => {
    expect(parseSearchNaturalLanguageQuery("all documents created two days ago", options)).toEqual({
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

test('parses account name after "all" then entity type', () => {
    expect(parseSearchNaturalLanguageQuery("all documents by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["all documents by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("all train documents by me", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["all", "documents by me"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("all documents by me about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["all documents by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("all documents by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: [],
        controlQueryTexts: ["all documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("all train documents by john", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["train"],
        controlQueryTexts: ["all", "documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseSearchNaturalLanguageQuery("all documents by john about trains", options)).toEqual({
        isLowConfidence: false,
        queryTexts: ["trains"],
        controlQueryTexts: ["all documents by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                account: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });
});
