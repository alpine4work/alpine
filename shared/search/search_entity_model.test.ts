import {generateId} from "~/shared/id/id.js";
import {
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {
    SearchChatEntityMediaModel,
    SearchEntityModel,
    SearchEntityModelData,
    isDeletedSearchEntity,
    mergeAccountOrAccountPileMedia,
} from "~/shared/search/search_entity_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {TaskTitleSnapshot} from "~/shared/tasks/title/task_title.js";

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

const deletedSearchEntityCases: Array<{
    name: string;
    entityData: SearchEntityModelData;
    expected: boolean;
}> = (() => {
    const createTaskTitleSnapshot = () => new Uint8Array() as TaskTitleSnapshot;
    const version = [0, 0] as const;

    return [
        {
            name: "deleted document",
            expected: true,
            entityData: {
                type: "Document",
                title: null,
                document: {id: generateId<DocumentId>(), version: 1},
            },
        },
        {
            name: "deleted task",
            expected: true,
            entityData: {
                type: "Task",
                title: null,
                task: {
                    id: generateId<TaskId>(),
                    titleSnapshot: createTaskTitleSnapshot(),
                    displayStatus: {value: "OpenInactive", version},
                },
            },
        },
        {
            name: "deleted task collection",
            expected: true,
            entityData: {
                type: "TaskCollection",
                title: null,
                collection: {
                    id: generateId<TaskCollectionId>(),
                    titleVersion: version,
                    color: {value: null, version},
                },
            },
        },
        {
            name: "document comment",
            expected: false,
            entityData: {
                type: "DocumentComment",
                title: null,
                comment: {
                    documentId: generateId<DocumentId>(),
                    commentThreadId: generateId<DocumentCommentThreadId>(),
                    index: 0,
                    author: createTestAccountModel(),
                },
            },
        },
        {
            name: "task with title",
            expected: false,
            entityData: {
                type: "Task",
                title: "Task",
                task: {
                    id: generateId<TaskId>(),
                    titleSnapshot: createTaskTitleSnapshot(),
                    displayStatus: {value: "OpenInactive", version},
                },
            },
        },
    ];
})();

test.each(deletedSearchEntityCases)(
    "deleted search entities are documents, tasks, and task collections with null title: $name",
    ({entityData, expected}) => {
        expect(isDeletedSearchEntity(entityData)).toBe(expected);
    },
);
