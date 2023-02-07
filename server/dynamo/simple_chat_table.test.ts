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
import {testMessagingImplementation} from "~/server/dynamo/test/test_messaging_implementation";
import {generateId} from "~/shared/id/id";
import {SimpleChatId} from "~/shared/id/types/id_types";

const context = createTestContext();
const SimpleChatTable = getSimpleChatTableForTest();

testMessagingImplementation<SimpleChatId>(context, {
    async createRoom(context, spaceId) {
        await authorizeSpaceAccess(context, spaceId);

        const simpleChatId = generateId<SimpleChatId>();

        await SimpleChatTable.createItem(context, {
            partitionType: "SimpleChat",
            sortRangeType: "Attributes",
            simpleChatId,
            spaceId,
            messagesSummary: {
                nextMessageIndex: 0,
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
    async createMessage(context, {roomKey: simpleChatId, parentMessageIndex, content}) {
        const message = await createSimpleChatMessage(context, {
            simpleChatId,
            parentMessageIndex,
            content,
        });

        return {
            index: message.index,
            createdTime: message.createdTime,
        };
    },
    async getMessage(context, {roomKey: simpleChatId, messageIndex}) {
        return getSimpleChatMessage(context, {simpleChatId, messageIndex});
    },
    async updateMessageContent(context, {roomKey: simpleChatId, messageIndex, content}) {
        return updateSimpleChatMessageContent(context, {
            simpleChatId,
            messageIndex,
            content,
        });
    },
    async deleteMessage(context, {roomKey: simpleChatId, messageIndex}) {
        return deleteSimpleChatMessage(context, {simpleChatId, messageIndex});
    },
    async getMessagesFromStart(
        context,
        {roomKey: simpleChatId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        return await getSimpleChatMessagesFromStart(context, {
            simpleChatId,
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        });
    },
    async getMessagesFromEnd(
        context,
        {roomKey: simpleChatId, limit, afterMessageIndex, beforeMessageIndex},
    ) {
        return getSimpleChatMessagesFromEnd(context, {
            simpleChatId,
            limit,
            afterMessageIndex,
            beforeMessageIndex,
        });
    },
});
