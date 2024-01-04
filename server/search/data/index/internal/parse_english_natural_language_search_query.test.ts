import _Fuse from "fuse.js";
import {
    accountNameFuseScoreMatchCutoff,
    parseEnglishNaturalLanguageSearchQuery,
} from "~/server/search/data/index/internal/parse_english_natural_language_search_query.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {assertTimeZone} from "~/shared/helpers/date/time_zone.js";
import {generateId} from "~/shared/id/id.js";

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
        createdTime,
    }),
    new AccountModel({
        id: generateId(),
        version: 0,
        name: "John Smith",
        nameVersion: 0,
        createdTime,
    }),
    new AccountModel({
        id: generateId(),
        version: 0,
        name: "Emily Smith",
        nameVersion: 0,
        createdTime,
    }),
    new AccountModel({
        id: generateId(),
        version: 0,
        name: "Anthony Mose",
        nameVersion: 0,
        createdTime,
    }),
    new AccountModel({
        id: generateId(),
        version: 0,
        name: "Emily Lin",
        nameVersion: 0,
        createdTime,
    }),
];

const accountNameIndex = new Fuse(accounts, {
    includeScore: true,
    keys: [
        {
            name: "name",
            getFn: account => account.initialData.name,
        },
    ],
});

const accountShortNameIndex = new Fuse(accounts, {
    includeScore: true,
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
            return accountNameIndex.search(queryText) as Array<{item: AccountModel; score: number}>;
        },
        searchShortNames: (queryText: string) => {
            return accountShortNameIndex.search(queryText) as Array<{
                item: AccountModel;
                score: number;
            }>;
        },
    },
};

test("account name search matches names with slight typos", () => {
    const nameIndex = new Fuse(
        [{name: "Caleb Meredith"}, {name: "Siobahn McDonough"}, {name: "Xue Seng Tay"}],
        {
            keys: ["name"],
            includeScore: true,
        },
    );

    const shortNameIndex = new Fuse([{name: "Caleb"}, {name: "Siobahn"}, {name: "Xue"}], {
        keys: ["name"],
        includeScore: true,
    });

    const search = (index: Fuse<unknown>, queryText: string) => {
        return index
            .search(queryText)
            .map(result => ({...result, isMatch: result.score! < accountNameFuseScoreMatchCutoff}));
    };

    expect(search(shortNameIndex, "Caleb")).toEqual([
        {score: 2.220446049250313e-16, refIndex: 0, item: {name: "Caleb"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "caleb")).toEqual([
        {score: 2.220446049250313e-16, refIndex: 0, item: {name: "Caleb"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Calebs")).toEqual([
        {score: 0.16666666666666666, refIndex: 0, item: {name: "Caleb"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Baleb")).toEqual([
        {score: 0.2, refIndex: 0, item: {name: "Caleb"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "baleb")).toEqual([
        {score: 0.2, refIndex: 0, item: {name: "Caleb"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Siobahn")).toEqual([
        {score: 2.220446049250313e-16, refIndex: 1, item: {name: "Siobahn"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "siobahn")).toEqual([
        {score: 2.220446049250313e-16, refIndex: 1, item: {name: "Siobahn"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Siobahns")).toEqual([
        {score: 0.125, refIndex: 1, item: {name: "Siobahn"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Siobahnn")).toEqual([
        {score: 0.125, refIndex: 1, item: {name: "Siobahn"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Soibahn")).toEqual([
        {score: 0.2857142857142857, refIndex: 1, item: {name: "Siobahn"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Soobahn")).toEqual([
        {score: 0.14285714285714285, refIndex: 1, item: {name: "Siobahn"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Soibann")).toEqual([
        {score: 0.42857142857142855, refIndex: 1, item: {name: "Siobahn"}, isMatch: false},
    ]);
    expect(search(shortNameIndex, "Soobann")).toEqual([
        {score: 0.2857142857142857, refIndex: 1, item: {name: "Siobahn"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Floorbhan")).toEqual([]);
    expect(search(shortNameIndex, "Xue")).toEqual([
        {score: 2.220446049250313e-16, refIndex: 2, item: {name: "Xue"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Xues")).toEqual([
        {score: 0.25, refIndex: 2, item: {name: "Xue"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Xu")).toEqual([
        {score: 0.001, refIndex: 2, item: {name: "Xue"}, isMatch: true},
    ]);
    expect(search(shortNameIndex, "Xuu")).toEqual([
        {score: 0.3333333333333333, refIndex: 2, item: {name: "Xue"}, isMatch: false},
    ]);
    expect(search(shortNameIndex, "Shue")).toEqual([
        {score: 0.5, refIndex: 2, item: {name: "Xue"}, isMatch: false},
    ]);

    expect(search(nameIndex, "Caleb")).toEqual([
        {score: 0.007568328950209746, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Caleb Meredith")).toEqual([
        {score: 8.569061098350962e-12, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Calebs Meredith")).toEqual([
        {score: 0.14740203517287173, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Caleb Merediths")).toEqual([
        {score: 0.14740203517287173, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Calebs Merediths")).toEqual([
        {score: 0.22988751153791454, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: true},
    ]);
    expect(search(nameIndex, "caleb meredith")).toEqual([
        {score: 8.569061098350962e-12, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Baleb Meredith")).toEqual([
        {score: 0.15477024809952394, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: true},
    ]);
    expect(search(nameIndex, "baleb meredith")).toEqual([
        {score: 0.15477024809952394, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Baleb Meredeth")).toEqual([
        {score: 0.2526478959047245, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Baleb Merideth")).toEqual([
        {score: 0.33652102717835264, refIndex: 0, item: {name: "Caleb Meredith"}, isMatch: false},
    ]);
    expect(search(nameIndex, "Siobahn McDonough")).toEqual([
        {
            score: 8.569061098350962e-12,
            refIndex: 1,
            item: {name: "Siobahn McDonough"},
            isMatch: true,
        },
    ]);
    expect(search(nameIndex, "siobahn mcdonough")).toEqual([
        {
            score: 8.569061098350962e-12,
            refIndex: 1,
            item: {name: "Siobahn McDonough"},
            isMatch: true,
        },
    ]);
    expect(search(nameIndex, "Siobahnn McDonough")).toEqual([
        {score: 0.12957533457264178, refIndex: 1, item: {name: "Siobahn McDonough"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Soibahn McDonough")).toEqual([
        {score: 0.22024234348850422, refIndex: 1, item: {name: "Siobahn McDonough"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Soobahn McDonough")).toEqual([
        {score: 0.13491884435321336, refIndex: 1, item: {name: "Siobahn McDonough"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Soibann McDonough")).toEqual([
        {score: 0.29335759711558734, refIndex: 1, item: {name: "Siobahn McDonough"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Soobann McDonough")).toEqual([
        {score: 0.22024234348850422, refIndex: 1, item: {name: "Siobahn McDonough"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Floorbhan McDonough")).toEqual([
        {score: 0.4426639328044773, refIndex: 1, item: {name: "Siobahn McDonough"}, isMatch: false},
    ]);
    expect(search(nameIndex, "Xue Seng Tay")).toEqual([
        {score: 9.287439764962262e-10, refIndex: 2, item: {name: "Xue Seng Tay"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Xue Seng")).toEqual([
        {score: 0.01857804455091699, refIndex: 2, item: {name: "Xue Seng Tay"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Xue")).toEqual([
        {score: 0.01857804455091699, refIndex: 2, item: {name: "Xue Seng Tay"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Xu Seng Tay")).toEqual([
        {score: 0.2506781151995667, refIndex: 2, item: {name: "Xue Seng Tay"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Xuu Seng Tay")).toEqual([
        {score: 0.23840338694026153, refIndex: 2, item: {name: "Xue Seng Tay"}, isMatch: true},
    ]);
    expect(search(nameIndex, "Shue Seng Tay")).toEqual([
        {score: 0.33958538680775424, refIndex: 2, item: {name: "Xue Seng Tay"}, isMatch: false},
    ]);
});

test("parses search entity type then account name", () => {
    expect(parseEnglishNaturalLanguageSearchQuery("documents by me", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents by", options)).toEqual({
        queryTexts: ["by"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents about by", options)).toEqual({
        queryTexts: ["by"],
        controlQueryTexts: ["documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents by about", options)).toEqual({
        queryTexts: ["by about"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents by me", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents by me about trains", options)).toEqual(
        {
            queryTexts: ["trains"],
            controlQueryTexts: ["documents by me about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents by john", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents by john", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents by john about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents by john trains", options)).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents by john smith", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents by john smith"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("trains1 documents by john trains2", options),
    ).toEqual({
        queryTexts: ["trains1", "trains2"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages from emily", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages from emily"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: {
                    field: "MajorContributor",
                    ids: [accounts[2]!.id, accounts[4]!.id],
                },
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("comments from emily", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["comments from emily"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: {
                    field: "MajorContributor",
                    ids: [accounts[2]!.id, accounts[4]!.id],
                },
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("post comments from emily", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["post comments from emily"],
        filters: [
            {
                entityTypes: ["PostComment"],
                accounts: {
                    field: "MajorContributor",
                    ids: [accounts[2]!.id, accounts[4]!.id],
                },
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages from emily smith", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages from emily smith"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: {field: "MajorContributor", ids: [accounts[2]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages from emily lin", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages from emily lin"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: {field: "MajorContributor", ids: [accounts[4]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messeges from emily", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messeges from emily"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: {
                    field: "MajorContributor",
                    ids: [accounts[2]!.id, accounts[4]!.id],
                },
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messsegees from emily", options)).toEqual({
        queryTexts: ["messsegees from emily"],
        controlQueryTexts: [],
        filters: [],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages from sarah", options)).toEqual({
        queryTexts: ["from sarah"],
        controlQueryTexts: ["messages"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: null,
                time: null,
            },
        ],
    });
});

test("parses search entity type then relationship then me", () => {
    expect(parseEnglishNaturalLanguageSearchQuery("documents created by me", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents created me", options)).toEqual({
        queryTexts: ["created me"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents created by me", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents created by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created by me about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents created by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written by me", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents written by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written me", options)).toEqual({
        queryTexts: ["written me"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents written by me", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents written by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents written by me about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents written by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated by me", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents updated by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated me", options)).toEqual({
        queryTexts: ["updated me"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents updated by me", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents updated by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents updated by me about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents updated by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated by me", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents udpated by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated me", options)).toEqual({
        queryTexts: ["udpated me"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents udpated by me", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents udpated by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents udpated by me about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents udpated by me about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });
});

test("parses search entity type then relationship then account name", () => {
    expect(parseEnglishNaturalLanguageSearchQuery("documents created by john", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents created by sara", options)).toEqual({
        queryTexts: ["created by sara"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents created john", options)).toEqual({
        queryTexts: ["created john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents created by john", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents created by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created by john trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents created by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created by john smith", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created by john smith"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created by john about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents created by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written by john", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents written by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written by sara", options)).toEqual({
        queryTexts: ["written by sara"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written john", options)).toEqual({
        queryTexts: ["written john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents written by john", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents written by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents written by john about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents written by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated by john", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents updated by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated john", options)).toEqual({
        queryTexts: ["updated john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents updated by john", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents updated by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents updated by john about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents updated by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated by sara", options)).toEqual({
        queryTexts: ["updated by sara"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated by john", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents udpated by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated john", options)).toEqual({
        queryTexts: ["udpated john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents udpated by john", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents udpated by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents udpated by john about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents udpated by john about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });
});

test("parses search entity type then I then relationship", () => {
    expect(parseEnglishNaturalLanguageSearchQuery("documents I created", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents I created"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents I", options)).toEqual({
        queryTexts: ["I"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I created", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents I created"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents I created about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents I created about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents I wrote", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents I wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents wrote", options)).toEqual({
        queryTexts: ["wrote"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I wrote", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents I wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents I wrote about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents I wrote about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents I updated", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents I updated"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated", options)).toEqual({
        queryTexts: ["updated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I updated", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents I updated"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents I updated about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents I updated about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents I udpated", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents I udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated", options)).toEqual({
        queryTexts: ["udpated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I udpated", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents I udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents I udpated about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents I udpated about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });
});

test("parses search entity type then account first name then relationship", () => {
    expect(parseEnglishNaturalLanguageSearchQuery("documents john created", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents john created"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john", options)).toEqual({
        queryTexts: ["john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john created", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["documents john created"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "Creator", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents john created about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john created about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john wrote", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents john wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents wrote", options)).toEqual({
        queryTexts: ["wrote"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john wrote", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents john wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents john wrote about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john wrote about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john updated", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents john updated"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated", options)).toEqual({
        queryTexts: ["updated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john updated", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["documents john updated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents john updated about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john updated about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john udpated", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents john udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated", options)).toEqual({
        queryTexts: ["udpated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john udpated", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["documents john udpated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents john udpated about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john udpated about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });
});

test("parses search entity type then account full name then relationship", () => {
    expect(parseEnglishNaturalLanguageSearchQuery("documents john smith created", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents john smith created"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "Creator", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents john smith", options)).toEqual({
        queryTexts: ["john smith"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents john smith created", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents john smith created"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents john smith created about trains",
            options,
        ),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john smith created about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john smith wrote", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents john smith wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents wrote", options)).toEqual({
        queryTexts: ["wrote"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents john smith wrote", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents john smith wrote"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents john smith wrote about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john smith wrote about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john smith updated", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents john smith updated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated", options)).toEqual({
        queryTexts: ["updated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents john smith updated", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents john smith updated"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents john smith updated about trains",
            options,
        ),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john smith updated about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john smith udpated", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents john smith udpated"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated", options)).toEqual({
        queryTexts: ["udpated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("train documents john smith udpated", options),
    ).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents john smith udpated"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents john smith udpated about trains",
            options,
        ),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents john smith udpated about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });
});

test("parses account name then entity type", () => {
    expect(parseEnglishNaturalLanguageSearchQuery("my documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["my documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train my documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["my documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["my documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my documents about trains", options)).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["my documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["john's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train john's documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("john's documents about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["john's documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["john smith's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train john smith's documents", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's documents train", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(
        parseEnglishNaturalLanguageSearchQuery("john smith's documents about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["john smith's documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("johns documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["johns documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train johns documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["johns documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("johns documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["johns documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("johns documents about trains", options)).toEqual(
        {
            queryTexts: ["trains"],
            controlQueryTexts: ["johns documents about"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("john smiths documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["john smiths documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train john smiths documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john smiths documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smiths documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john smiths documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("john smiths documents about trains", options),
    ).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["john smiths documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john", options)).toEqual({
        queryTexts: ["john"],
        controlQueryTexts: [],
        filters: [],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith", options)).toEqual({
        queryTexts: ["john smith"],
        controlQueryTexts: [],
        filters: [],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jahn documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["jahn documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jahn's documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["jahn's documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jahns documents", options)).toEqual({
        queryTexts: ["jahns"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jaahn documents", options)).toEqual({
        queryTexts: ["jaahn"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jaahn's documents", options)).toEqual({
        queryTexts: ["jaahn's"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jaahns documents", options)).toEqual({
        queryTexts: ["jaahns"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });
});

test("parses account name with some text between then entity type", () => {
    expect(parseEnglishNaturalLanguageSearchQuery("my train documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["my", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's train documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's train documents", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(
        parseEnglishNaturalLanguageSearchQuery("my neat documents about georgia", options),
    ).toEqual({
        queryTexts: ["neat", "georgia"],
        controlQueryTexts: ["my", "documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
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
    expect(
        parseEnglishNaturalLanguageSearchQuery("john's neat documents about georgia", options),
    ).toEqual({
        queryTexts: ["john's neat", "georgia"],
        controlQueryTexts: ["documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "john smith's neat documents about georgia",
            options,
        ),
    ).toEqual({
        queryTexts: ["john smith's neat", "georgia"],
        controlQueryTexts: ["documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("my train documents about georgia", options),
    ).toEqual({
        queryTexts: ["my train", "georgia"],
        controlQueryTexts: ["documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("john's train documents about georgia", options),
    ).toEqual({
        queryTexts: ["john's train", "georgia"],
        controlQueryTexts: ["documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "john smith's train documents about georgia",
            options,
        ),
    ).toEqual({
        queryTexts: ["john smith's train", "georgia"],
        controlQueryTexts: ["documents about"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my closed tasks", options)).toEqual({
        queryTexts: ["closed"],
        controlQueryTexts: ["my", "tasks"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's closed tasks", options)).toEqual({
        queryTexts: ["john's closed"],
        controlQueryTexts: ["tasks"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's closed tasks", options)).toEqual({
        queryTexts: ["john smith's closed"],
        controlQueryTexts: ["tasks"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my green documents", options)).toEqual({
        queryTexts: ["green"],
        controlQueryTexts: ["my", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's green documents", options)).toEqual({
        queryTexts: ["green"],
        controlQueryTexts: ["john's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's green documents", options)).toEqual(
        {
            queryTexts: ["green"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                    time: null,
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("john's smith documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["john's smith documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("my the cat in the hat documents", options),
    ).toEqual({
        queryTexts: ["the cat in the hat"],
        controlQueryTexts: ["my", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("john's the cat in the hat documents", options),
    ).toEqual({
        queryTexts: ["the cat in the hat"],
        controlQueryTexts: ["john's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "john smith's the cat in the hat documents",
            options,
        ),
    ).toEqual({
        queryTexts: ["the cat in the hat"],
        controlQueryTexts: ["john smith's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("my (the cat in the hat) documents", options),
    ).toEqual({
        queryTexts: ["(the cat in the hat)"],
        controlQueryTexts: ["my", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("john's (the cat in the hat) documents", options),
    ).toEqual({
        queryTexts: ["(the cat in the hat)"],
        controlQueryTexts: ["john's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "john smith's (the cat in the hat) documents",
            options,
        ),
    ).toEqual({
        queryTexts: ["(the cat in the hat)"],
        controlQueryTexts: ["john smith's", "documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("my, the cat in the hat, chat messages", options),
    ).toEqual({
        queryTexts: ["my, the cat in the hat,"],
        controlQueryTexts: ["chat messages"],
        filters: [
            {
                entityTypes: ["ChatMessage"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "john's, the cat in the hat, chat messages",
            options,
        ),
    ).toEqual({
        queryTexts: ["john's, the cat in the hat,"],
        controlQueryTexts: ["chat messages"],
        filters: [
            {
                entityTypes: ["ChatMessage"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "john smith's, the cat in the hat, chat messages",
            options,
        ),
    ).toEqual({
        queryTexts: ["john smith's, the cat in the hat,"],
        controlQueryTexts: ["chat messages"],
        filters: [
            {
                entityTypes: ["ChatMessage"],
                accounts: null,
                time: null,
            },
        ],
    });
});

test("parses standalone entity type", () => {
    expect(parseEnglishNaturalLanguageSearchQuery("documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("chat message", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["chat message"],
        filters: [
            {
                entityTypes: ["ChatMessage"],
                accounts: null,
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: null,
                time: null,
            },
        ],
    });
});

test("correctly splits query texts", () => {
    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "train1 train2 documents train3 train4 chat train5 train6",
            options,
        ),
    ).toEqual({
        queryTexts: ["train1 train2", "train3 train4", "train5 train6"],
        controlQueryTexts: ["documents", "chat"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
                time: null,
            },
            {
                entityTypes: ["Chat"],
                accounts: null,
                time: null,
            },
        ],
    });
});

test("provides duration slop when referencing precise date", () => {
    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 1 minute ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 1 minute ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 2 minutes ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 2 minutes ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 5 minutes ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 5 minutes ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(parseEnglishNaturalLanguageSearchQuery("documents created 1 hour ago", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents created 1 hour ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-04T12:27:17.615Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-04T13:12:49.836Z"),
                        },
                    },
                },
            ],
        },
    );

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 2 hours ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 2 hours ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 24 hours ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 24 hours ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(parseEnglishNaturalLanguageSearchQuery("documents created yesterday", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(parseEnglishNaturalLanguageSearchQuery("documents created 2 days ago", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents created 2 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-02T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-03T06:59:59.999Z"),
                        },
                    },
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents created 3 days ago", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents created 3 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-01T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-02T06:59:59.999Z"),
                        },
                    },
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents created 4 days ago", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents created 4 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-31T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents created 5 days ago", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents created 5 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-30T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-31T06:59:59.999Z"),
                        },
                    },
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents created 6 days ago", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents created 6 days ago"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-29T04:00:41.781Z"),
                            inclusiveUpperBoundDate: new Date("2023-12-30T09:59:18.217Z"),
                        },
                    },
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents created last week", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created last week"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 2 weeks ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 2 weeks ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(parseEnglishNaturalLanguageSearchQuery("documents created last month", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents created last month"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: null,
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-01T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                },
            ],
        },
    );

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 2 months ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 2 months ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 3 months ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 3 months ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 4 months ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 4 months ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 6 months ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 6 months ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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
    expect(
        parseEnglishNaturalLanguageSearchQuery("documents created 2 weeks ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created 2 weeks ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents updated 2 weeks ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents updated 2 weeks ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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
        parseEnglishNaturalLanguageSearchQuery("documents last updated 2 weeks ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents last updated 2 weeks ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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
        parseEnglishNaturalLanguageSearchQuery("documents udpated 2 weeks ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents udpated 2 weeks ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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
        parseEnglishNaturalLanguageSearchQuery("documents last udpated 2 weeks ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents last udpated 2 weeks ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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
        parseEnglishNaturalLanguageSearchQuery("documents updated before 2 weeks ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents updated before 2 weeks ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents updated after 2 weeks ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents updated after 2 weeks ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("messages sent after yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages sent after yesterday"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: null,
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("messages sent before yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages sent before yesterday"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: null,
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

    expect(parseEnglishNaturalLanguageSearchQuery("posts from yesterday", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["posts from yesterday"],
        filters: [
            {
                entityTypes: ["Post"],
                accounts: null,
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
        accounts: {field: "Creator", ids: [accounts[0]!.id]},
        time: {
            field: "Created",
            range: {
                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
            },
        },
    };

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents created by me and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created by me and created yesterday"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents created by me that were created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created by me that were created yesterday"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents created by me and were created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created by me and were created yesterday"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents created by me created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created by me created yesterday"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents created yesterday and created by me",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created yesterday and created by me"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents created yesterday that were created by me",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created yesterday that were created by me"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents created yesterday and were created by me",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created yesterday and were created by me"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents created yesterday created by me",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created yesterday created by me"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents written by me and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents written by me and created yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery(
            "documents updated by me and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents updated by me and created yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery(
            "documents written yesterday and created by me",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents written yesterday and created by me"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents updated yesterday and created by me",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents updated yesterday and created by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
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
        accounts: {field: "Creator", ids: [accounts[0]!.id]},
        time: {
            field: "Created",
            range: {
                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
            },
        },
    };

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents created by me and created yesterday and created by me",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created by me"],
        controlQueryTexts: ["documents created by me and created yesterday"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents written by me and created yesterday and created by me",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created by me"],
        controlQueryTexts: ["documents written by me and created yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery(
            "documents updated by me and created yesterday and created by me",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created by me"],
        controlQueryTexts: ["documents updated by me and created yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery(
            "documents created yesterday and created by me and created by me",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created by me"],
        controlQueryTexts: ["documents created yesterday and created by me"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents written yesterday and created by me and created by me",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created by me"],
        controlQueryTexts: ["documents written yesterday and created by me"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents updated yesterday and created by me and created by me",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created by me"],
        controlQueryTexts: ["documents updated yesterday and created by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery(
            "documents created by me and created yesterday and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created yesterday"],
        controlQueryTexts: ["documents created by me and created yesterday"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents written by me and created yesterday and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created yesterday"],
        controlQueryTexts: ["documents written by me and created yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery(
            "documents updated by me and created yesterday and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created yesterday"],
        controlQueryTexts: ["documents updated by me and created yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery(
            "documents created yesterday and created by me and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created yesterday"],
        controlQueryTexts: ["documents created yesterday and created by me"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents written yesterday and created by me and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created yesterday"],
        controlQueryTexts: ["documents written yesterday and created by me"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents updated yesterday and created by me and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: ["and created yesterday"],
        controlQueryTexts: ["documents updated yesterday and created by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
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

    expect(parseEnglishNaturalLanguageSearchQuery("documents by john by me", options)).toEqual({
        queryTexts: ["by me"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents by me by john", options)).toEqual({
        queryTexts: ["by john"],
        controlQueryTexts: ["documents by me"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents from two days ago and then from yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: ["and then from yesterday"],
        controlQueryTexts: ["documents from two days ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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
        accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
        time: {
            field: "Created",
            range: {
                inclusiveLowerBoundDate: new Date("2024-01-03T07:00:00.000Z"),
                inclusiveUpperBoundDate: new Date("2024-01-04T06:59:59.999Z"),
            },
        },
    };

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents by me created yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents by me created yesterday"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents by me that were created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents by me that were created yesterday"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "documents from me that were created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents from me that were created yesterday"],
        filters: [filter],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("documents from yesterday that I created", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents from yesterday that I created"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery("documents I created from yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents I created from yesterday"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
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
    expect(parseEnglishNaturalLanguageSearchQuery("tasks I created yesterday", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks I created yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
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

    expect(parseEnglishNaturalLanguageSearchQuery("tasks by me yesterday", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks by me yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery("tasks created by me yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks created by me yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery("tasks written by me yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks written by me yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
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

    expect(parseEnglishNaturalLanguageSearchQuery("tasks I updated yesterday", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks I updated yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery("tasks updated by me yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks updated by me yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
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

    expect(parseEnglishNaturalLanguageSearchQuery("tasks john created yesterday", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["tasks john created yesterday"],
            filters: [
                {
                    entityTypes: ["Task"],
                    accounts: {field: "Creator", ids: [accounts[1]!.id]},
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

    expect(parseEnglishNaturalLanguageSearchQuery("tasks by john yesterday", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks by john yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery("tasks created by john yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks created by john yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "Creator", ids: [accounts[1]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery("tasks written by john yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks written by john yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
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

    expect(parseEnglishNaturalLanguageSearchQuery("tasks john updated yesterday", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["tasks john updated yesterday"],
            filters: [
                {
                    entityTypes: ["Task"],
                    accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
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

    expect(
        parseEnglishNaturalLanguageSearchQuery("tasks updated by john yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks updated by john yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "AnyContributor", ids: [accounts[1]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery("tasks I created before yesterday", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["tasks I created before yesterday"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery(
            "tasks I created before and created yesterday",
            options,
        ),
    ).toEqual({
        queryTexts: ["before and created yesterday"],
        controlQueryTexts: ["tasks I created"],
        filters: [
            {
                entityTypes: ["Task"],
                accounts: {field: "Creator", ids: [accounts[0]!.id]},
                time: null,
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages from me last week", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages from me last week"],
        filters: [
            {
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
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

    expect(parseEnglishNaturalLanguageSearchQuery("messages from john last week", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["messages from john last week"],
            filters: [
                {
                    entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                    accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
                    time: {
                        field: "Created",
                        range: {
                            inclusiveLowerBoundDate: new Date("2023-12-25T07:00:00.000Z"),
                            inclusiveUpperBoundDate: new Date("2024-01-01T06:59:59.999Z"),
                        },
                    },
                },
            ],
        },
    );
});

test("parses date modifier after account name then entity type", () => {
    expect(
        parseEnglishNaturalLanguageSearchQuery("my documents created two days ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["my documents created two days ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery("john's documents created two days ago", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["john's documents created two days ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery("my green documents created two days ago", options),
    ).toEqual({
        queryTexts: ["green"],
        controlQueryTexts: ["my", "documents created two days ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[0]!.id]},
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
        parseEnglishNaturalLanguageSearchQuery(
            "john's green documents created two days ago",
            options,
        ),
    ).toEqual({
        queryTexts: ["green"],
        controlQueryTexts: ["john's", "documents created two days ago"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
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
    expect(parseEnglishNaturalLanguageSearchQuery("documents created recently", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents created recently"],
        filters: [
            {
                entityTypes: ["Document"],
                accounts: null,
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

    expect(parseEnglishNaturalLanguageSearchQuery("documents i updated recently", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents i updated recently"],
            filters: [
                {
                    entityTypes: ["Document"],
                    accounts: {field: "AnyContributor", ids: [accounts[0]!.id]},
                    time: {
                        field: "LastUpdated",
                        range: {
                            inclusiveLowerBoundDate: new Date("2024-01-01T13:50:03.726Z"),
                            inclusiveUpperBoundDate: null,
                        },
                    },
                },
            ],
        },
    );

    expect(
        parseEnglishNaturalLanguageSearchQuery("chat messages sent recently by john", options),
    ).toEqual({
        queryTexts: [],
        controlQueryTexts: ["chat messages sent recently by john"],
        filters: [
            {
                entityTypes: ["ChatMessage"],
                accounts: {field: "MajorContributor", ids: [accounts[1]!.id]},
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
