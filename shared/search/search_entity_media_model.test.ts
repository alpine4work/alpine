import {
    SearchEntityMediaModel,
    mergeSearchEntityMediaModel,
} from "~/shared/search/search_entity_media_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

test("merge account pile media", () => {
    const account1a = createTestAccountModel({
        name: "foo",
    });

    const account1b = createTestAccountModel({
        id: account1a.id,
        version: 1,
        name: "foo 2",
    });

    const account2a = createTestAccountModel({
        name: "bar",
    });

    const account2b = createTestAccountModel({
        id: account2a.id,
        version: 1,
        name: "bar 2",
    });

    const account3 = createTestAccountModel({
        name: "qux",
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
