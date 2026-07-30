import {generateId} from "~/shared/id/id.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {
    SearchChatEntityMediaModel,
    SearchEntityModel,
    mergeAccountOrAccountPileMedia,
} from "~/shared/search/search_entity_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

test("if title versions are equal than the second title\u2019s data wins", () => {
    const postId = generateId<PostId>();
    const author = createTestAccountModel();

    expect(
        SearchEntityModel.mergeData(
            {
                type: "Post",
                title: "a",
                post: {
                    id: postId,
                    version: 4,
                    channelVersion: 2,
                    author: author,
                },
            },
            {
                type: "Post",
                title: "b",
                post: {
                    id: postId,
                    version: 4,
                    channelVersion: 2,
                    author: author,
                },
            },
        ).title,
    ).toEqual("b");

    expect(
        SearchEntityModel.mergeData(
            {
                type: "Post",
                title: "b",
                post: {
                    id: postId,
                    version: 4,
                    channelVersion: 2,
                    author: author,
                },
            },
            {
                type: "Post",
                title: "a",
                post: {
                    id: postId,
                    version: 4,
                    channelVersion: 2,
                    author: author,
                },
            },
        ).title,
    ).toEqual("a");
});

test("merging chat search entities merges their `AccountPile` media", () => {
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

    const media1: SearchChatEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1a, account2a, account3],
        accountCount: 3,
    };

    const media2: SearchChatEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1a, account2a, account3],
        accountCount: 3,
    };

    const media3: SearchChatEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1a, account2a],
        accountCount: 2,
    };

    const media4: SearchChatEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1a, account2b, account3],
        accountCount: 3,
    };

    const media5: SearchChatEntityMediaModel = {
        type: "AccountPile",
        previewAccounts: [account1b, account2a, account3],
        accountCount: 3,
    };

    expect(mergeAccountOrAccountPileMedia(media1, media2)).toBe(media1);
    expect(mergeAccountOrAccountPileMedia(media1, media3)).toBe(media3);
    expect(mergeAccountOrAccountPileMedia(media3, media1)).toBe(media1);
    expect(mergeAccountOrAccountPileMedia(media1, media4)).toBe(media4);
    expect(mergeAccountOrAccountPileMedia(media4, media1)).toBe(media4);

    expect(mergeAccountOrAccountPileMedia(media4, media5)).not.toBe(media4);
    expect(mergeAccountOrAccountPileMedia(media4, media5)).not.toBe(media5);
    expect(mergeAccountOrAccountPileMedia(media4, media5)).toEqual({
        type: "AccountPile",
        previewAccounts: [account1b, account2b, account3],
        accountCount: 3,
    });

    expect(mergeAccountOrAccountPileMedia(media5, media4)).not.toBe(media4);
    expect(mergeAccountOrAccountPileMedia(media5, media4)).not.toBe(media5);
    expect(mergeAccountOrAccountPileMedia(media5, media4)).toEqual({
        type: "AccountPile",
        previewAccounts: [account1b, account2b, account3],
        accountCount: 3,
    });
});
