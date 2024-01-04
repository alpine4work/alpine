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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents by me", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents by me"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents by me about trains", options)).toEqual(
        {
            queryTexts: ["trains"],
            controlQueryTexts: ["documents by me about"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[0]!.id],
                    entityTypes: ["Document"],
                    level: "CreatorOrMajorContributor",
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents by john", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents by john", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents by john trains", options)).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["documents by john"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents by john smith", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents by john smith"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages from emily", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages from emily"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[2]!.id, accounts[4]!.id],
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("comments from emily", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["comments from emily"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[2]!.id, accounts[4]!.id],
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("post comments from emily", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["post comments from emily"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[2]!.id, accounts[4]!.id],
                entityTypes: ["PostComment"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages from emily smith", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages from emily smith"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[2]!.id],
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages from emily lin", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages from emily lin"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[4]!.id],
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messeges from emily", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messeges from emily"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[2]!.id, accounts[4]!.id],
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
                level: "CreatorOrMajorContributor",
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
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "Creator",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents created me", options)).toEqual({
        queryTexts: ["created me"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "Creator",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "Creator",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written by me", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents written by me"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written me", options)).toEqual({
        queryTexts: ["written me"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated by me", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents updated by me"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated me", options)).toEqual({
        queryTexts: ["updated me"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated by me", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents udpated by me"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated me", options)).toEqual({
        queryTexts: ["udpated me"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "Creator",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents created by sara", options)).toEqual({
        queryTexts: ["created by sara"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents created john", options)).toEqual({
        queryTexts: ["created john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "Creator",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "Creator",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "Creator",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "Creator",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written by john", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents written by john"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written by sara", options)).toEqual({
        queryTexts: ["written by sara"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written john", options)).toEqual({
        queryTexts: ["written john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated by john", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents updated by john"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated john", options)).toEqual({
        queryTexts: ["updated john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated by sara", options)).toEqual({
        queryTexts: ["updated by sara"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated by john", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents udpated by john"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated john", options)).toEqual({
        queryTexts: ["udpated john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "Creator",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents I", options)).toEqual({
        queryTexts: ["I"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I created", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents I created"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "Creator",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "Creator",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents I wrote", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents I wrote"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents wrote", options)).toEqual({
        queryTexts: ["wrote"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I wrote", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents I wrote"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents I updated", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents I updated"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated", options)).toEqual({
        queryTexts: ["updated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I updated", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents I updated"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents I udpated", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents I udpated"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated", options)).toEqual({
        queryTexts: ["udpated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I udpated", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents I udpated"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "Creator",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john", options)).toEqual({
        queryTexts: ["john"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john created", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["documents john created"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "Creator",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "Creator",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john wrote", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents john wrote"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents wrote", options)).toEqual({
        queryTexts: ["wrote"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john wrote", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents john wrote"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john updated", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents john updated"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated", options)).toEqual({
        queryTexts: ["updated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john updated", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["documents john updated"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john udpated", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents john udpated"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated", options)).toEqual({
        queryTexts: ["udpated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john udpated", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["documents john udpated"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "Creator",
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents john smith", options)).toEqual({
        queryTexts: ["john smith"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "Creator",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "Creator",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john smith wrote", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["documents john smith wrote"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents wrote", options)).toEqual({
        queryTexts: ["wrote"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john smith updated", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents john smith updated"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "AnyContributor",
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents updated", options)).toEqual({
        queryTexts: ["updated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents john smith udpated", options)).toEqual(
        {
            queryTexts: [],
            controlQueryTexts: ["documents john smith udpated"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "AnyContributor",
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated", options)).toEqual({
        queryTexts: ["udpated"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "AnyContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train my documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["my documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["my documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my documents about trains", options)).toEqual({
        queryTexts: ["trains"],
        controlQueryTexts: ["my documents about"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["john's documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train john's documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john's documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john's documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["john smith's documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train john smith's documents", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's documents"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "CreatorOrMajorContributor",
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
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("johns documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["johns documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train johns documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["johns documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("johns documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["johns documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("johns documents about trains", options)).toEqual(
        {
            queryTexts: ["trains"],
            controlQueryTexts: ["johns documents about"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "CreatorOrMajorContributor",
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("john smiths documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["john smiths documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train john smiths documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john smiths documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smiths documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john smiths documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jahn's documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["jahn's documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jahns documents", options)).toEqual({
        queryTexts: ["jahns"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jaahn documents", options)).toEqual({
        queryTexts: ["jaahn"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jaahn's documents", options)).toEqual({
        queryTexts: ["jaahn's"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jaahns documents", options)).toEqual({
        queryTexts: ["jaahns"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's train documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["john's", "documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's train documents", options)).toEqual(
        {
            queryTexts: ["train"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
        queryTexts: ["john's neat", "about georgia"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "john smith's neat documents about georgia",
            options,
        ),
    ).toEqual({
        queryTexts: ["john smith's neat", "about georgia"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("my train documents about georgia", options),
    ).toEqual({
        queryTexts: ["my train", "about georgia"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery("john's train documents about georgia", options),
    ).toEqual({
        queryTexts: ["john's train", "about georgia"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(
        parseEnglishNaturalLanguageSearchQuery(
            "john smith's train documents about georgia",
            options,
        ),
    ).toEqual({
        queryTexts: ["john smith's train", "about georgia"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my closed tasks", options)).toEqual({
        queryTexts: ["closed"],
        controlQueryTexts: ["my", "tasks"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Task"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's closed tasks", options)).toEqual({
        queryTexts: ["john's closed"],
        controlQueryTexts: ["tasks"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Task"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's closed tasks", options)).toEqual({
        queryTexts: ["john smith's closed"],
        controlQueryTexts: ["tasks"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Task"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my green documents", options)).toEqual({
        queryTexts: ["green"],
        controlQueryTexts: ["my", "documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john's green documents", options)).toEqual({
        queryTexts: ["green"],
        controlQueryTexts: ["john's", "documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's green documents", options)).toEqual(
        {
            queryTexts: ["green"],
            controlQueryTexts: ["john smith's", "documents"],
            filters: [
                {
                    type: "Account",
                    accountIds: [accounts[1]!.id],
                    entityTypes: ["Document"],
                    level: "CreatorOrMajorContributor",
                },
            ],
        },
    );

    expect(parseEnglishNaturalLanguageSearchQuery("john's smith documents", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["john's smith documents"],
        filters: [
            {
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[0]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "Account",
                accountIds: [accounts[1]!.id],
                entityTypes: ["Document"],
                level: "CreatorOrMajorContributor",
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
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["ChatMessage"],
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
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["ChatMessage"],
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
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["ChatMessage"],
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
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents train", options)).toEqual({
        queryTexts: ["train"],
        controlQueryTexts: ["documents"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("chat message", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["chat message"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["ChatMessage"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages", options)).toEqual({
        queryTexts: [],
        controlQueryTexts: ["messages"],
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
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
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Chat"],
            },
        ],
    });
});
