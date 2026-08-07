import {intoApiInboxEntry} from "~/server/api/internal/spaces/internal/into_api_inbox_entry.js";
import {ContentReferencesSearchEntity} from "~/shared/content/content_references.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, ChatId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {InboxChatEntryModel, InboxTaskEntryModel} from "~/shared/notifications/inbox_model.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {emptyTaskTitleModel} from "~/shared/tasks/title/task_title.js";

function createTaskEntry(
    task:
        | {isPrivate: true; isDeleted: boolean; taskId: TaskId}
        | {isPrivate: false; taskId: TaskId; taskOwner: AccountModel},
): InboxTaskEntryModel {
    return new InboxTaskEntryModel({
        spaceId: generateId<SpaceId>(),
        accountId: generateId<AccountId>(),
        task,
        loudNotificationCount: 0,
        isArchived: false,
        latestComment: {
            author: createTestAccountModel({name: "Alice Smith"}),
            createdTime: new Date("2026-01-01T00:00:00Z"),
            index: 3,
            contentTextSnippet: "Test task comment",
            isStickyMention: false,
        },
        otherCommentAuthor: null,
    });
}

function createChatEntry(chatId: ChatId): InboxChatEntryModel {
    return new InboxChatEntryModel({
        spaceId: generateId<SpaceId>(),
        accountId: generateId<AccountId>(),
        chatId,
        definition: {type: "Direct", accountCount: 2},
        loudNotificationCount: 0,
        isArchived: false,
        latestMessage: {
            author: createTestAccountModel({name: "Alice Smith"}),
            createdTime: new Date("2026-01-01T00:00:00Z"),
            index: 3,
            contentTextSnippet: "Test chat message",
            isStickyMention: false,
        },
        otherChatAccount: null,
    });
}
describe("intoApiInboxEntry()", () => {
    describe("task entry", () => {
        test("uses the resolved title and status for an accessible task", () => {
            const taskId = generateId<TaskId>();
            const entry = createTaskEntry({
                isPrivate: false,
                taskId,
                taskOwner: createTestAccountModel(),
            });
            const resolved: ContentReferencesSearchEntity = {
                isPrivate: false,
                entity: new SearchEntityModel({
                    type: "Task",
                    title: "Ship it",
                    task: {
                        id: taskId,
                        titleSnapshot: emptyTaskTitleModel.get().getSnapshot(),
                        displayStatus: {value: "OpenActive", version: [0, 0]},
                    },
                }),
            };

            const result = intoApiInboxEntry(entry, resolved);

            assert(result.type === "TaskMessages");
            expect(result.task).toEqual({
                type: "Task",
                id: taskId,
                title: "Ship it",
                status: {type: "Open", isActive: true},
            });
        });

        test("flags a private task with a placeholder title", () => {
            const taskId = generateId<TaskId>();
            const entry = createTaskEntry({isPrivate: true, isDeleted: false, taskId});

            const result = intoApiInboxEntry(entry, {isPrivate: true});

            assert(result.type === "TaskMessages");
            expect(result.task).toEqual({
                type: "Task",
                id: taskId,
                title: "Private task",
                status: {type: "Closed"},
                private: true,
            });
        });

        test("flags a deleted task when the entity no longer resolves", () => {
            const taskId = generateId<TaskId>();
            const entry = createTaskEntry({
                isPrivate: false,
                taskId,
                taskOwner: createTestAccountModel(),
            });

            const result = intoApiInboxEntry(entry, null);

            assert(result.type === "TaskMessages");
            expect(result.task).toEqual({
                type: "Task",
                id: taskId,
                title: "Deleted task",
                status: {type: "Closed"},
                deleted: true,
            });
        });

        test("flags a deleted task when the resolved entity has a null title", () => {
            const taskId = generateId<TaskId>();
            const entry = createTaskEntry({
                isPrivate: false,
                taskId,
                taskOwner: createTestAccountModel(),
            });
            const resolved: ContentReferencesSearchEntity = {
                isPrivate: false,
                entity: new SearchEntityModel({
                    type: "Task",
                    title: null,
                    task: {
                        id: taskId,
                        titleSnapshot: emptyTaskTitleModel.get().getSnapshot(),
                        displayStatus: {value: "Closed", version: [0, 0]},
                    },
                }),
            };

            const result = intoApiInboxEntry(entry, resolved);

            assert(result.type === "TaskMessages");
            expect(result.task).toEqual({
                type: "Task",
                id: taskId,
                title: "Deleted task",
                status: {type: "Closed"},
                deleted: true,
            });
        });
    });

    describe("chat entry", () => {
        test("uses the resolved title for an accessible chat", () => {
            const chatId = generateId<ChatId>();
            const entry = createChatEntry(chatId);
            const resolved: ContentReferencesSearchEntity = {
                isPrivate: false,
                entity: new SearchEntityModel({
                    type: "Chat",
                    title: "Design room",
                    chat: {
                        id: chatId,
                        version: 1,
                        media: {type: "Account", account: createTestAccountModel()},
                    },
                }),
            };

            const result = intoApiInboxEntry(entry, resolved);

            assert(result.type === "Chat");
            expect(result.chat).toEqual({type: "Chat", id: chatId, title: "Design room"});
        });

        test("flags a private chat with a placeholder title", () => {
            const chatId = generateId<ChatId>();
            const entry = createChatEntry(chatId);

            const result = intoApiInboxEntry(entry, {isPrivate: true});

            assert(result.type === "Chat");
            expect(result.chat).toEqual({
                type: "Chat",
                id: chatId,
                title: "Private chat",
                private: true,
            });
        });

        test("flags a deleted chat when the entity no longer resolves", () => {
            const chatId = generateId<ChatId>();
            const entry = createChatEntry(chatId);

            const result = intoApiInboxEntry(entry, null);

            assert(result.type === "Chat");
            expect(result.chat).toEqual({
                type: "Chat",
                id: chatId,
                title: "Deleted chat",
                deleted: true,
            });
        });
    });
});
