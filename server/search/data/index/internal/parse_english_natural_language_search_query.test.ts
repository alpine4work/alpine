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
        queryText: "",
        controlQueryText: "documents by me",
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
        queryText: "train",
        controlQueryText: "documents by me",
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
            queryText: "trains",
            controlQueryText: "documents by me about",
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
        queryText: "",
        controlQueryText: "documents by john",
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
        queryText: "train",
        controlQueryText: "documents by john",
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
        queryText: "trains",
        controlQueryText: "documents by john about",
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
        queryText: "trains",
        controlQueryText: "documents by john",
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
        queryText: "",
        controlQueryText: "documents by john smith",
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
        queryText: "trains1 trains2",
        controlQueryText: "documents by john",
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
        queryText: "",
        controlQueryText: "messages from emily",
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
        queryText: "",
        controlQueryText: "comments from emily",
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
        queryText: "",
        controlQueryText: "post comments from emily",
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
        queryText: "",
        controlQueryText: "messages from emily smith",
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
        queryText: "",
        controlQueryText: "messages from emily lin",
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
        queryText: "",
        controlQueryText: "messeges from emily",
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
        queryText: "messsegees from emily",
        controlQueryText: "",
        filters: [],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages from sarah", options)).toEqual({
        queryText: "from sarah",
        controlQueryText: "messages",
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
        queryText: "",
        controlQueryText: "documents created by me",
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
        queryText: "created me",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents created by me",
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
        queryText: "trains",
        controlQueryText: "documents created by me about",
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
        queryText: "",
        controlQueryText: "documents written by me",
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
        queryText: "written me",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents written by me",
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
        queryText: "trains",
        controlQueryText: "documents written by me about",
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
        queryText: "",
        controlQueryText: "documents updated by me",
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
        queryText: "updated me",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents updated by me",
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
        queryText: "trains",
        controlQueryText: "documents updated by me about",
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
        queryText: "",
        controlQueryText: "documents udpated by me",
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
        queryText: "udpated me",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents udpated by me",
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
        queryText: "trains",
        controlQueryText: "documents udpated by me about",
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
        queryText: "",
        controlQueryText: "documents created by john",
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
        queryText: "created by sara",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents created john", options)).toEqual({
        queryText: "created john",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents created by john",
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
        queryText: "trains",
        controlQueryText: "documents created by john",
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
        queryText: "",
        controlQueryText: "documents created by john smith",
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
        queryText: "trains",
        controlQueryText: "documents created by john about",
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
        queryText: "",
        controlQueryText: "documents written by john",
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
        queryText: "written by sara",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents written john", options)).toEqual({
        queryText: "written john",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents written by john",
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
        queryText: "trains",
        controlQueryText: "documents written by john about",
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
        queryText: "",
        controlQueryText: "documents updated by john",
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
        queryText: "updated john",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents updated by john",
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
        queryText: "trains",
        controlQueryText: "documents updated by john about",
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
        queryText: "updated by sara",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents udpated by john", options)).toEqual({
        queryText: "",
        controlQueryText: "documents udpated by john",
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
        queryText: "udpated john",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents udpated by john",
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
        queryText: "trains",
        controlQueryText: "documents udpated by john about",
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
        queryText: "",
        controlQueryText: "documents I created",
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
        queryText: "I",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I created", options)).toEqual({
        queryText: "train",
        controlQueryText: "documents I created",
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
        queryText: "trains",
        controlQueryText: "documents I created about",
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
        queryText: "",
        controlQueryText: "documents I wrote",
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
        queryText: "wrote",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I wrote", options)).toEqual({
        queryText: "train",
        controlQueryText: "documents I wrote",
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
        queryText: "trains",
        controlQueryText: "documents I wrote about",
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
        queryText: "",
        controlQueryText: "documents I updated",
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
        queryText: "updated",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I updated", options)).toEqual({
        queryText: "train",
        controlQueryText: "documents I updated",
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
        queryText: "trains",
        controlQueryText: "documents I updated about",
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
        queryText: "",
        controlQueryText: "documents I udpated",
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
        queryText: "udpated",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents I udpated", options)).toEqual({
        queryText: "train",
        controlQueryText: "documents I udpated",
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
        queryText: "trains",
        controlQueryText: "documents I udpated about",
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
        queryText: "",
        controlQueryText: "documents john created",
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
        queryText: "john",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john created", options)).toEqual(
        {
            queryText: "train",
            controlQueryText: "documents john created",
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
        queryText: "trains",
        controlQueryText: "documents john created about",
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
        queryText: "",
        controlQueryText: "documents john wrote",
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
        queryText: "wrote",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john wrote", options)).toEqual({
        queryText: "train",
        controlQueryText: "documents john wrote",
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
        queryText: "trains",
        controlQueryText: "documents john wrote about",
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
        queryText: "",
        controlQueryText: "documents john updated",
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
        queryText: "updated",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john updated", options)).toEqual(
        {
            queryText: "train",
            controlQueryText: "documents john updated",
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
        queryText: "trains",
        controlQueryText: "documents john updated about",
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
        queryText: "",
        controlQueryText: "documents john udpated",
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
        queryText: "udpated",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents john udpated", options)).toEqual(
        {
            queryText: "train",
            controlQueryText: "documents john udpated",
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
        queryText: "trains",
        controlQueryText: "documents john udpated about",
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
            queryText: "",
            controlQueryText: "documents john smith created",
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
        queryText: "john smith",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents john smith created",
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
        queryText: "trains",
        controlQueryText: "documents john smith created about",
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
        queryText: "",
        controlQueryText: "documents john smith wrote",
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
        queryText: "wrote",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents john smith wrote",
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
        queryText: "trains",
        controlQueryText: "documents john smith wrote about",
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
            queryText: "",
            controlQueryText: "documents john smith updated",
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
        queryText: "updated",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents john smith updated",
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
        queryText: "trains",
        controlQueryText: "documents john smith updated about",
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
            queryText: "",
            controlQueryText: "documents john smith udpated",
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
        queryText: "udpated",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "documents john smith udpated",
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
        queryText: "trains",
        controlQueryText: "documents john smith udpated about",
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
        queryText: "",
        controlQueryText: "my documents",
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
        queryText: "train",
        controlQueryText: "my documents",
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
        queryText: "train",
        controlQueryText: "my documents",
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
        queryText: "trains",
        controlQueryText: "my documents about",
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
        queryText: "",
        controlQueryText: "john's documents",
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
        queryText: "train",
        controlQueryText: "john's documents",
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
        queryText: "train",
        controlQueryText: "john's documents",
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
        queryText: "trains",
        controlQueryText: "john's documents about",
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
        queryText: "",
        controlQueryText: "john smith's documents",
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
            queryText: "train",
            controlQueryText: "john smith's documents",
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
            queryText: "train",
            controlQueryText: "john smith's documents",
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
        queryText: "trains",
        controlQueryText: "john smith's documents about",
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
        queryText: "",
        controlQueryText: "johns documents",
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
        queryText: "train",
        controlQueryText: "johns documents",
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
        queryText: "train",
        controlQueryText: "johns documents",
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
            queryText: "trains",
            controlQueryText: "johns documents about",
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
        queryText: "",
        controlQueryText: "john smiths documents",
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
        queryText: "train",
        controlQueryText: "john smiths documents",
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
        queryText: "train",
        controlQueryText: "john smiths documents",
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
        queryText: "trains",
        controlQueryText: "john smiths documents about",
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
        queryText: "john",
        controlQueryText: "",
        filters: [],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith", options)).toEqual({
        queryText: "john smith",
        controlQueryText: "",
        filters: [],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jahn documents", options)).toEqual({
        queryText: "",
        controlQueryText: "jahn documents",
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
        queryText: "",
        controlQueryText: "jahn's documents",
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
        queryText: "jahns",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jaahn documents", options)).toEqual({
        queryText: "jaahn",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jaahn's documents", options)).toEqual({
        queryText: "jaahn's",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("jaahns documents", options)).toEqual({
        queryText: "jaahns",
        controlQueryText: "documents",
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
        queryText: "train",
        controlQueryText: "my documents",
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
        queryText: "train",
        controlQueryText: "john's documents",
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
            queryText: "train",
            controlQueryText: "john smith's documents",
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
        queryText: "neat georgia",
        controlQueryText: "my documents about",
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
        queryText: "john's neat about georgia",
        controlQueryText: "documents",
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
        queryText: "john smith's neat about georgia",
        controlQueryText: "documents",
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
        queryText: "my train about georgia",
        controlQueryText: "documents",
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
        queryText: "john's train about georgia",
        controlQueryText: "documents",
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
        queryText: "john smith's train about georgia",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my closed tasks", options)).toEqual({
        queryText: "closed",
        controlQueryText: "my tasks",
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
        queryText: "john's closed",
        controlQueryText: "tasks",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Task"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("john smith's closed tasks", options)).toEqual({
        queryText: "john smith's closed",
        controlQueryText: "tasks",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Task"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("my green documents", options)).toEqual({
        queryText: "green",
        controlQueryText: "my documents",
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
        queryText: "green",
        controlQueryText: "john's documents",
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
            queryText: "green",
            controlQueryText: "john smith's documents",
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
        queryText: "",
        controlQueryText: "john's smith documents",
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
        queryText: "the cat in the hat",
        controlQueryText: "my documents",
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
        queryText: "the cat in the hat",
        controlQueryText: "john's documents",
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
        queryText: "the cat in the hat",
        controlQueryText: "john smith's documents",
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
        queryText: "(the cat in the hat)",
        controlQueryText: "my documents",
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
        queryText: "(the cat in the hat)",
        controlQueryText: "john's documents",
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
        queryText: "(the cat in the hat)",
        controlQueryText: "john smith's documents",
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
        queryText: "my, the cat in the hat,",
        controlQueryText: "chat messages",
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
        queryText: "john's, the cat in the hat,",
        controlQueryText: "chat messages",
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
        queryText: "john smith's, the cat in the hat,",
        controlQueryText: "chat messages",
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
        queryText: "",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("train documents", options)).toEqual({
        queryText: "train",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("documents train", options)).toEqual({
        queryText: "train",
        controlQueryText: "documents",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["Document"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("chat message", options)).toEqual({
        queryText: "",
        controlQueryText: "chat message",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["ChatMessage"],
            },
        ],
    });

    expect(parseEnglishNaturalLanguageSearchQuery("messages", options)).toEqual({
        queryText: "",
        controlQueryText: "messages",
        filters: [
            {
                type: "StandaloneSearchEntityTypes",
                entityTypes: ["ChatMessage", "DocumentComment", "PostComment"],
            },
        ],
    });
});
