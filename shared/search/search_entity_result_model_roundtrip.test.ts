import {assertOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    ChannelId,
    ChatId,
    DatabaseTableId,
    DocumentId,
    SiteId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {SearchAffinityEntityModel, SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {SearchFavoriteEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {
    TaskTitleModel,
    createTaskTitleFromText,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

// Regression tests for the outer/inner discriminator collision in
// `SearchEntityResultModelSchema`. The outer wrapper must not overwrite the inner
// `type` field, otherwise non-Account favorites fail to deserialize with
// `Unknown type`. The fix uses `_modelType` as the outer discriminator key so the
// inner `type` survives the roundtrip.
describe("SearchFavoriteEntityResultModel schema roundtrip", () => {
    function roundtrip(
        model: SearchAffinityEntityModel | ReturnType<typeof createTestAccountModel>,
    ) {
        const original = new SearchFavoriteEntityResultModel({
            score: 0,
            favoriteOrderKey: assertOrderKey("a0"),
            // The schema accepts both `AccountModel` and `SearchAffinityEntityModel`.
            model: model as SearchAffinityEntityModel,
        });
        const schema = SearchFavoriteEntityResultModel.schema();
        return schema.deserialize(schema.serialize(original));
    }

    test("Document", () => {
        const documentId = generateId<DocumentId>();
        const result = roundtrip(
            SearchAffinityEntityModel.new({
                type: "Document",
                title: "doc",
                document: {
                    id: documentId,
                    version: 0,
                },
            }),
        );
        expect(result.model).toBeInstanceOf(SearchEntityModel);
        expect(result.model.getSearchEntityId()).toBe(`Document:${documentId}`);
    });

    test("Channel", () => {
        const channelId = generateId<ChannelId>();
        const result = roundtrip(
            SearchAffinityEntityModel.new({
                type: "Channel",
                title: "channel",
                channel: {
                    id: channelId,
                    version: 0,
                },
            }),
        );
        expect(result.model.getSearchEntityId()).toBe(`Channel:${channelId}`);
    });

    test("DatabaseTable", () => {
        const tableId = generateId<DatabaseTableId>();
        const result = roundtrip(
            SearchAffinityEntityModel.new({
                type: "DatabaseTable",
                title: "database",
                table: {id: tableId},
            }),
        );
        expect(result.model.getSearchEntityId()).toBe(`DatabaseTable:${tableId}`);
    });

    test("Chat (Direct media)", () => {
        const chatId = generateId<ChatId>();
        const result = roundtrip(
            SearchAffinityEntityModel.new({
                type: "Chat",
                title: "chat",
                chat: {
                    id: chatId,
                    version: 0,
                    media: {
                        type: "AccountPile",
                        previewAccounts: [createTestAccountModel({name: "a"})],
                        accountCount: 1,
                    },
                },
            }),
        );
        expect(result.model.getSearchEntityId()).toBe(`Chat:${chatId}`);
    });

    test("Task", () => {
        const taskId = generateId<TaskId>();
        const result = roundtrip(
            SearchAffinityEntityModel.new({
                type: "Task",
                title: "task",
                task: {
                    id: taskId,
                    titleSnapshot: new TaskTitleModel(
                        createTaskTitleFromText(randomlyGenerateTaskTitleClientId(), "task"),
                    ).getSnapshot(),
                    displayStatus: {value: "OpenInactive", version: [0, 0]},
                },
            }),
        );
        expect(result.model.getSearchEntityId()).toBe(`Task:${taskId}`);
    });

    test("TaskCollection", () => {
        const collectionId = generateId<TaskCollectionId>();
        const result = roundtrip(
            SearchAffinityEntityModel.new({
                type: "TaskCollection",
                title: "collection",
                collection: {
                    id: collectionId,
                    titleVersion: [0, 0],
                    color: {value: null, version: [0, 0]},
                },
            }),
        );
        expect(result.model.getSearchEntityId()).toBe(`TaskCollection:${collectionId}`);
    });

    test("Site", () => {
        const siteId = generateId<SiteId>();
        const result = roundtrip(
            SearchAffinityEntityModel.new({
                type: "Site",
                title: "site",
                site: {
                    id: siteId,
                    version: 0,
                    firstEntityId: null,
                },
            }),
        );
        expect(result.model.getSearchEntityId()).toBe(`Site:${siteId}`);
    });

    test("Static (TaskPersonal)", () => {
        const result = roundtrip(
            SearchAffinityEntityModel.new({
                type: "Static",
                id: "TaskPersonal",
                title: "My tasks",
            }),
        );
        expect(result.model.initialData).toMatchObject({type: "Static", id: "TaskPersonal"});
    });

    test("Account control case", () => {
        const account = createTestAccountModel({name: "Alice"});
        const result = roundtrip(account);
        // Account models go through the `Account` outer variant, not the inner union.
        expect(result.model).toBeInstanceOf(AccountModel);
        expect(result.model.id).toEqual(account.id);
    });
});
