import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {MessageContent, MessageContentSchema} from "~/shared/content/message_content_schema";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {AccountId, SimpleChatId, SpaceId} from "~/shared/id/types/id_types";
import {SimpleChatMessageModel} from "~/shared/models/simple_chat_model";
import {Schema} from "~/shared/schema/schema";

// TODO(calebmer): This is temporary for me to test the new messaging
// functionality. It will be deleted once I am happy.
const SimpleChatTable = DynamoTableSchema.new({
    name: "SimpleChat",
    partitions: {
        SimpleChat: {
            partitionKeyAttributes: {
                simpleChatId: DynamoKeyAttributeSchema.id<SimpleChatId>(),
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        messagesSummary: Schema.object({
                            nextMessageId: Schema.integer.min(1),
                            messageCount: Schema.integer.min(0),
                        }).default({
                            nextMessageId: 1,
                            messageCount: 0,
                        }),
                    }),
                },
                Messages: {
                    sortKeyAttributes: {
                        messageId: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        parentMessageId: Schema.integer.nullable(),
                        content: MessageContentSchema,
                        contentUpdatedTime: Schema.date.nullable(),
                    }),
                },
            },
        },
    },
});

type SimpleChatMessageItem = DynamoTableItemType<typeof SimpleChatTable, "SimpleChat", "Messages">;

/**
 * We are not allowed to export our DynamoDB tables so instead export a
 * function that can only be used in Jest tests.
 */
export function getSimpleChatTableForTest() {
    assert(typeof jest !== "undefined");
    return SimpleChatTable;
}

export async function seedTestSimpleChats(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {testSimpleChatId, defaultSpaceId} = getDynamoSeedConstants();

    await SimpleChatTable.createItemIfNoneExists(context, {
        partitionType: "SimpleChat",
        sortRangeType: "Attributes",
        simpleChatId: testSimpleChatId,
        spaceId: defaultSpaceId,
        messagesSummary: {
            nextMessageId: 1,
            messageCount: 0,
        },
    });
}

export async function getSimpleChat(context: RequestContext, id: SimpleChatId) {
    const simpleChatItem = await SimpleChatTable.getItem(context, {
        partitionType: "SimpleChat",
        sortRangeType: "Attributes",
        simpleChatId: id,
    });
    if (!simpleChatItem) return null;

    await authorizeSpaceAccess(context, simpleChatItem.spaceId);

    return {
        simpleChatId: simpleChatItem.simpleChatId,
        spaceId: simpleChatItem.spaceId,
        messageCount: simpleChatItem.messagesSummary.messageCount,
    };
}

export async function createSimpleChatMessage(
    context: RequestContext,
    {
        simpleChatId,
        parentMessageId,
        content,
    }: {
        simpleChatId: SimpleChatId;
        parentMessageId: number | null;
        content: MessageContent;
    },
): Promise<{
    id: number;
    createdTime: Date;
}> {
    return retryDynamoConditionCheckErrors(async () => {
        const [simpleChatItem] = await runAllPromiseThunks(
            async () => {
                const simpleChatItem = await SimpleChatTable.getPartialItem(
                    context,
                    {
                        partitionType: "SimpleChat",
                        sortRangeType: "Attributes",
                        simpleChatId,
                    },
                    {
                        attributes: ["spaceId", "messagesSummary", "updateLockVersion"],
                    },
                );
                if (!simpleChatItem) throw new NotFoundError("Simple chat not found");
                await authorizeSpaceAccess(context, simpleChatItem.spaceId);

                return simpleChatItem;
            },
            async () => {
                if (typeof parentMessageId !== "number") return;

                const parentMessageItem = await SimpleChatTable.getPartialItem(
                    context,
                    {
                        partitionType: "SimpleChat",
                        sortRangeType: "Messages",
                        simpleChatId,
                        messageId: parentMessageId,
                    },
                    {
                        attributes: [],
                    },
                );
                if (!parentMessageItem)
                    throw new NotFoundError("Simple chat parent message not found");
            },
        );

        const messageId = simpleChatItem.messagesSummary.nextMessageId;
        const createdTime = new Date();
        const authorId = context.auth.getAccountId();

        await DynamoTableSchema.executeTransaction(context, [
            SimpleChatTable.transactionCreateItem({
                partitionType: "SimpleChat",
                sortRangeType: "Messages",
                simpleChatId,
                messageId,
                authorId,
                createdTime,
                parentMessageId,
                content,
                contentUpdatedTime: null,
            }),
            SimpleChatTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "SimpleChat", sortRangeType: "Attributes", simpleChatId},
                "messagesSummary",
                {
                    nextMessageId: simpleChatItem.messagesSummary.nextMessageId + 1,
                    messageCount: simpleChatItem.messagesSummary.messageCount + 1,
                },
                {updateLockVersion: simpleChatItem.updateLockVersion},
            ),
        ]);

        return {
            id: messageId,
            createdTime,
        };
    });
}

export async function getSimpleChatMessage(
    context: RequestContext,
    {simpleChatId, messageId}: {simpleChatId: SimpleChatId; messageId: number},
): Promise<SimpleChatMessageModel | null> {
    const [simpleChat, item] = await runAllPromises([
        getSimpleChat(context, simpleChatId),
        SimpleChatTable.getItem(context, {
            partitionType: "SimpleChat",
            sortRangeType: "Messages",
            simpleChatId,
            messageId,
        }),
    ]);
    if (!simpleChat) throw new NotFoundError("Simple chat not found");

    if (!item) return null;
    return createSimpleChatMessageModelFromItem(context, simpleChat.spaceId, item);
}

async function createSimpleChatMessageModelFromItem(
    context: RequestContext,
    spaceId: SpaceId,
    item: SimpleChatMessageItem,
): Promise<SimpleChatMessageModel> {
    return new SimpleChatMessageModel({
        id: item.messageId,
        author: await getAccountOrThrow(context, spaceId, item.authorId),
        createdTime: item.createdTime,
        parentMessageId: item.parentMessageId,
        content: item.content,
        contentUpdatedTime: item.contentUpdatedTime,
    });
}

export function updateSimpleChatMessageContent(
    context: RequestContext,
    {
        simpleChatId,
        messageId,
        content,
    }: {simpleChatId: SimpleChatId; messageId: number; content: MessageContent},
): Promise<{
    contentUpdatedTime: Date;
}> {
    return retryDynamoConditionCheckErrors(async () => {
        const [simpleChat, item] = await runAllPromises([
            getSimpleChat(context, simpleChatId),
            SimpleChatTable.getItem(context, {
                partitionType: "SimpleChat",
                sortRangeType: "Messages",
                simpleChatId,
                messageId,
            }),
        ]);
        if (!simpleChat) throw new NotFoundError("Simple chat not found");

        if (!item) throw new NotFoundError("Simple chat message not found");

        if (item.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only update simple chat messages you authored");

        const contentUpdatedTime = new Date();
        await SimpleChatTable.directlyUpdateItem(context, {...item, content, contentUpdatedTime});

        return {contentUpdatedTime};
    });
}

export function deleteSimpleChatMessage(
    context: RequestContext,
    {simpleChatId, messageId}: {simpleChatId: SimpleChatId; messageId: number},
): Promise<void> {
    return retryDynamoConditionCheckErrors(async () => {
        const [simpleChatItem, messageItem] = await runAllPromises([
            SimpleChatTable.getItem(context, {
                partitionType: "SimpleChat",
                sortRangeType: "Attributes",
                simpleChatId,
            }),
            SimpleChatTable.getItem(context, {
                partitionType: "SimpleChat",
                sortRangeType: "Messages",
                simpleChatId,
                messageId,
            }),
        ]);

        if (!simpleChatItem) throw new NotFoundError("Simple chat not found");
        if (!messageItem) throw new NotFoundError("Simple chat message not found");

        await authorizeSpaceAccess(context, simpleChatItem.spaceId);

        if (messageItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only delete simple chat messages you authored");

        await DynamoTableSchema.executeTransaction(context, [
            SimpleChatTable.transactionDeleteItem(messageItem),
            SimpleChatTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "SimpleChat", sortRangeType: "Attributes", simpleChatId},
                "messagesSummary",
                {
                    nextMessageId: simpleChatItem.messagesSummary.nextMessageId,
                    messageCount: simpleChatItem.messagesSummary.messageCount - 1,
                },
                {updateLockVersion: simpleChatItem.updateLockVersion},
            ),
        ]);
    });
}

export async function getSimpleChatMessagesFromStart(
    context: RequestContext,
    {
        simpleChatId,
        limit,
        afterMessageId,
    }: {
        simpleChatId: SimpleChatId;
        limit: number;
        afterMessageId: number | null;
    },
): Promise<{
    hasMoreMessagesAfter: boolean;
    messages: Array<SimpleChatMessageModel>;
}> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = SimpleChatTable.query(context, {
        startKey: {
            partitionType: "SimpleChat",
            sortRangeType: "Messages",
            simpleChatId,
            messageId: (afterMessageId ?? 0) + 1,
        },
        endKey: {
            partitionType: "SimpleChat",
            sortRangeType: "Messages",
            simpleChatId,
            messageId: Number.MAX_SAFE_INTEGER,
        },
        // Add one to the limit so we can determine whether there are more
        // messages after.
        limit: limit + 1,
    });

    const simpleChat = await getSimpleChat(context, simpleChatId);
    if (!simpleChat) throw new NotFoundError("Simple chat not found");

    const queriedMessages = await parallelMapAsyncIterableToArray(
        queryIterable,
        async (item, index) => {
            // For items outside our limit, don't create a message model. We will
            // throw these away.
            if (index >= limit) return null;

            return createSimpleChatMessageModelFromItem(context, simpleChat.spaceId, item);
        },
    );

    // Drop any queried messages outside of our limit.
    const messages = queriedMessages.slice(0, limit) as Array<SimpleChatMessageModel>;
    const hasMoreMessagesAfter = queriedMessages.length > limit;

    return {messages, hasMoreMessagesAfter};
}

export async function getSimpleChatMessagesFromEnd(
    context: RequestContext,
    {
        simpleChatId,
        limit,
        beforeMessageId,
    }: {
        simpleChatId: SimpleChatId;
        limit: number;
        beforeMessageId: number | null;
    },
): Promise<{
    hasMoreMessagesBefore: boolean;
    messages: Array<SimpleChatMessageModel>;
}> {
    // Base case: If we are loading before the first message ID we know there are
    // no messages.
    if (beforeMessageId === 1) {
        return {messages: [], hasMoreMessagesBefore: false};
    }

    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = SimpleChatTable.query(context, {
        startKey: {
            partitionType: "SimpleChat",
            sortRangeType: "Messages",
            simpleChatId,
            messageId: 1,
        },
        endKey: {
            partitionType: "SimpleChat",
            sortRangeType: "Messages",
            simpleChatId,
            messageId:
                typeof beforeMessageId === "number" ? beforeMessageId - 1 : Number.MAX_SAFE_INTEGER,
        },
        // Add one to the limit so we can determine whether there are more
        // messages after.
        limit: limit + 1,
        // Scan backwards from `endKey` to `startKey` so we can get messages at the end
        // instead of start.
        descending: true,
    });

    const simpleChat = await getSimpleChat(context, simpleChatId);
    if (!simpleChat) throw new NotFoundError("Simple chat not found");

    const queriedMessages = await parallelMapAsyncIterableToArray(
        queryIterable,
        async (item, index) => {
            // For items outside our limit, don't create a message model. We will
            // throw these away.
            if (index >= limit) return null;

            return createSimpleChatMessageModelFromItem(context, simpleChat.spaceId, item);
        },
    );

    // Drop any queried messages outside of our limit.
    const messages = queriedMessages.slice(0, limit).reverse() as Array<SimpleChatMessageModel>;
    const hasMoreMessagesBefore = queriedMessages.length > limit;

    return {messages, hasMoreMessagesBefore};
}
