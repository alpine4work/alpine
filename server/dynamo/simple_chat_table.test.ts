import {
    createSimpleChatMessage,
    deleteSimpleChatMessage,
    getSimpleChat,
    getSimpleChatMessage,
    getSimpleChatMessagesFromEnd,
    getSimpleChatMessagesFromStart,
    getSimpleChatTableForTest,
    updateSimpleChatMessageContent,
} from "~/server/dynamo/simple_chat_table";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {createTestContext} from "~/server/dynamo/test/create_test_context";
import {testMessageImplementation} from "~/server/dynamo/test/test_messaging_implementation";
import {generateId} from "~/shared/id/id";
import {SimpleChatId} from "~/shared/id/types/id_types";

const context = createTestContext();
const SimpleChatTable = getSimpleChatTableForTest();

testMessageImplementation<SimpleChatId>(context, {
    async createRoom(context, spaceId) {
        await authorizeSpaceAccess(context, spaceId);

        const simpleChatId = generateId<SimpleChatId>();

        await SimpleChatTable.createItem(context, {
            partitionType: "SimpleChat",
            sortRangeType: "Attributes",
            simpleChatId,
            spaceId,
            messagesSummary: {
                nextMessageId: 1,
                messageCount: 0,
            },
        });

        return {
            key: simpleChatId,
            spaceId,
            messageCount: 0,
        };
    },
    async getRoom(context, postId) {
        const simpleChat = await getSimpleChat(context, postId);
        if (!simpleChat) return null;

        return {
            key: simpleChat.id,
            spaceId: simpleChat.spaceId,
            messageCount: simpleChat.messageCount,
        };
    },
    getMissingRoomKey() {
        return generateId();
    },
    async createMessage(context, {roomKey: simpleChatId, parentMessageId, content}) {
        const message = await createSimpleChatMessage(context, {
            simpleChatId,
            parentMessageId,
            content,
        });

        return {
            id: message.id,
            createdTime: message.createdTime,
        };
    },
    async getMessage(context, {roomKey: simpleChatId, messageId}) {
        return getSimpleChatMessage(context, {simpleChatId, messageId});
    },
    async updateMessageContent(context, {roomKey: simpleChatId, messageId, content}) {
        return updateSimpleChatMessageContent(context, {
            simpleChatId,
            messageId,
            content,
        });
    },
    async deleteMessage(context, {roomKey: simpleChatId, messageId}) {
        return deleteSimpleChatMessage(context, {simpleChatId, messageId});
    },
    async getMessagesFromStart(context, {roomKey: simpleChatId, limit, afterMessageId}) {
        return await getSimpleChatMessagesFromStart(context, {
            simpleChatId,
            limit,
            afterMessageId,
        });
    },
    async getMessagesFromEnd(context, {roomKey: simpleChatId, limit, beforeMessageId}) {
        return getSimpleChatMessagesFromEnd(context, {
            simpleChatId,
            limit,
            beforeMessageId,
        });
    },
});
