import {generateId} from "~/shared/id/id.js";
import {
    SearchEntityMediaModel,
    mergeSearchEntityMediaModel,
} from "~/shared/search/search_entity_media_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

test("merge account pile media", () => {
    const account1a = new AccountModel({
        id: generateId(),
        version: 0,
        name: "foo",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: new Date(),
            state: {type: "Active"},
            role: "Member",
        },
    });

    const account1b = new AccountModel({
        id: account1a.id,
        version: 1,
        name: "foo 2",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: new Date(),
            state: {type: "Active"},
            role: "Member",
        },
    });

    const account2a = new AccountModel({
        id: generateId(),
        version: 0,
        name: "bar",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: new Date(),
            state: {type: "Active"},
            role: "Member",
        },
    });

    const account2b = new AccountModel({
        id: account2a.id,
        version: 1,
        name: "bar 2",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: new Date(),
            state: {type: "Active"},
            role: "Member",
        },
    });

    const account3 = new AccountModel({
        id: generateId(),
        version: 0,
        name: "qux",
        nameVersion: 0,
        space: {
            version: 0,
            addedTime: new Date(),
            state: {type: "Active"},
            role: "Member",
        },
    });

    const media1: SearchEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1a, account2a, account3],
        accountCount: 3,
    };

    const media2: SearchEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1a, account2a, account3],
        accountCount: 3,
    };

    const media3: SearchEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1a, account2a],
        accountCount: 2,
    };

    const media4: SearchEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1a, account2b, account3],
        accountCount: 3,
    };

    const media5: SearchEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1b, account2a, account3],
        accountCount: 3,
    };

    expect(mergeSearchEntityMediaModel(media1, media2)).toBe(media1);
    expect(mergeSearchEntityMediaModel(media1, media3)).toBe(media3);
    expect(mergeSearchEntityMediaModel(media3, media1)).toBe(media1);
    expect(mergeSearchEntityMediaModel(media1, media4)).toBe(media4);
    expect(mergeSearchEntityMediaModel(media4, media1)).toBe(media4);

    expect(mergeSearchEntityMediaModel(media4, media5)).not.toBe(media4);
    expect(mergeSearchEntityMediaModel(media4, media5)).not.toBe(media5);
    expect(mergeSearchEntityMediaModel(media4, media5)).toEqual({
        type: "AccountPile",
        previewAccounts: [account1b, account2b, account3],
        accountCount: 3,
    });

    expect(mergeSearchEntityMediaModel(media5, media4)).not.toBe(media4);
    expect(mergeSearchEntityMediaModel(media5, media4)).not.toBe(media5);
    expect(mergeSearchEntityMediaModel(media5, media4)).toEqual({
        type: "AccountPile",
        previewAccounts: [account1b, account2b, account3],
        accountCount: 3,
    });
});
