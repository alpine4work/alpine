import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {MessageContent} from "~/shared/content/message_content_schema";
import {FailedPreconditionError, NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {AccountId, SimpleChatId, SpaceId} from "~/shared/id/types/id_types";
import {MessagePayloadSchema} from "~/shared/models/message_interface";
import {SimpleChatMessageModel, SimpleChatModel} from "~/shared/models/simple_chat_model";
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
                            nextMessageIndex: Schema.integer.min(0),
                            messageCount: Schema.integer.min(0),
                        }),
                    }),
                },
                Messages: {
                    sortKeyAttributes: {
                        messageIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        payload: MessagePayloadSchema,
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
            nextMessageIndex: 0,
            messageCount: 0,
        },
    });
}

export async function getSimpleChat(
    context: RequestContext,
    id: SimpleChatId,
): Promise<SimpleChatModel | null> {
    const simpleChatItem = await SimpleChatTable.getItem(context, {
        partitionType: "SimpleChat",
        sortRangeType: "Attributes",
        simpleChatId: id,
    });
    if (!simpleChatItem) return null;

    await authorizeSpaceAccess(context, simpleChatItem.spaceId);

    return new SimpleChatModel({
        id: simpleChatItem.simpleChatId,
        spaceId: simpleChatItem.spaceId,
        messageCount: simpleChatItem.messagesSummary.messageCount,
    });
}

export async function createSimpleChatMessage(
    context: RequestContext,
    {
        simpleChatId,
        parentMessageIndex,
        content,
    }: {
        simpleChatId: SimpleChatId;
        parentMessageIndex: number | null;
        content: MessageContent;
    },
): Promise<{
    index: number;
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
                if (typeof parentMessageIndex !== "number") return;

                const parentMessageItem = await SimpleChatTable.getPartialItem(
                    context,
                    {
                        partitionType: "SimpleChat",
                        sortRangeType: "Messages",
                        simpleChatId,
                        messageIndex: parentMessageIndex,
                    },
                    {
                        attributes: [],
                    },
                );
                if (!parentMessageItem)
                    throw new NotFoundError("Simple chat parent message not found");
            },
        );

        const messageIndex = simpleChatItem.messagesSummary.nextMessageIndex;
        const createdTime = new Date();
        const authorId = context.auth.getAccountId();

        await DynamoTableSchema.executeTransaction(context, [
            SimpleChatTable.transactionCreateItem({
                partitionType: "SimpleChat",
                sortRangeType: "Messages",
                simpleChatId,
                messageIndex,
                authorId,
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex,
                    content,
                    contentUpdatedTime: null,
                },
            }),
            SimpleChatTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "SimpleChat", sortRangeType: "Attributes", simpleChatId},
                "messagesSummary",
                {
                    nextMessageIndex: simpleChatItem.messagesSummary.nextMessageIndex + 1,
                    messageCount: simpleChatItem.messagesSummary.messageCount + 1,
                },
                {updateLockVersion: simpleChatItem.updateLockVersion},
            ),
        ]);

        return {
            index: messageIndex,
            createdTime,
        };
    });
}

export async function getSimpleChatMessage(
    context: RequestContext,
    {simpleChatId, messageIndex}: {simpleChatId: SimpleChatId; messageIndex: number},
): Promise<SimpleChatMessageModel | null> {
    const [simpleChat, item] = await runAllPromises([
        getSimpleChat(context, simpleChatId),
        SimpleChatTable.getItem(context, {
            partitionType: "SimpleChat",
            sortRangeType: "Messages",
            simpleChatId,
            messageIndex,
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
        simpleChatId: item.simpleChatId,
        index: item.messageIndex,
        author: await getAccountOrThrow(context, spaceId, item.authorId),
        createdTime: item.createdTime,
        payload: item.payload,
    });
}

export function updateSimpleChatMessageContent(
    context: RequestContext,
    {
        simpleChatId,
        messageIndex,
        content,
    }: {
        simpleChatId: SimpleChatId;
        messageIndex: number;
        content: MessageContent;
    },
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
                messageIndex,
            }),
        ]);
        if (!simpleChat) throw new NotFoundError("Simple chat not found");

        if (!item) throw new NotFoundError("Simple chat message not found");

        if (item.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only update simple chat messages you authored");

        if (item.payload.type !== "Content")
            throw new FailedPreconditionError("Can not update comments with a non-content payload");

        const contentUpdatedTime = new Date(
            item.payload.contentUpdatedTime
                ? Math.max(item.payload.contentUpdatedTime.getTime() + 1, Date.now())
                : Date.now(),
        );

        await SimpleChatTable.directlyUpdateItem(context, {
            ...item,
            payload: {
                ...item.payload,
                content,
                contentUpdatedTime,
            },
        });

        return {contentUpdatedTime};
    });
}

export function deleteSimpleChatMessage(
    context: RequestContext,
    {simpleChatId, messageIndex}: {simpleChatId: SimpleChatId; messageIndex: number},
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
                messageIndex,
            }),
        ]);

        if (!simpleChatItem) throw new NotFoundError("Simple chat not found");
        if (!messageItem) throw new NotFoundError("Simple chat message not found");

        await authorizeSpaceAccess(context, simpleChatItem.spaceId);

        if (messageItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only delete simple chat messages you authored");

        if (messageItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not delete comments with a non-content payload");

        const deletedTime = new Date(
            messageItem.payload.contentUpdatedTime
                ? Math.max(messageItem.payload.contentUpdatedTime.getTime() + 1, Date.now())
                : Date.now(),
        );

        await SimpleChatTable.directlyUpdateItem(context, {
            ...messageItem,
            payload: {type: "Deleted", deletedTime},
        });
    });
}

export async function getSimpleChatMessagesFromStart(
    context: RequestContext,
    {
        simpleChatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        simpleChatId: SimpleChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messageCount: number;
    messages: Array<SimpleChatMessageModel>;
}> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = SimpleChatTable.query(context, {
        startKey: {
            partitionType: "SimpleChat",
            sortRangeType: "Messages",
            simpleChatId,
            messageIndex: typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
        },
        endKey: {
            partitionType: "SimpleChat",
            sortRangeType: "Messages",
            simpleChatId,
            messageIndex:
                typeof beforeMessageIndex === "number"
                    ? beforeMessageIndex - 1
                    : Number.MAX_SAFE_INTEGER,
        },
        limit,
    });

    const simpleChat = await getSimpleChat(context, simpleChatId);
    if (!simpleChat) throw new NotFoundError("Simple chat not found");

    const messages = await parallelMapAsyncIterableToArray(queryIterable, item =>
        createSimpleChatMessageModelFromItem(context, simpleChat.spaceId, item),
    );

    return {
        // Make sure `messageCount` is consistent with `messages` in case of eventual
        // consistency race conditions.
        messageCount: Math.max(
            simpleChat.messageCount,
            messages.length > 0 ? messages[messages.length - 1]!.index + 1 : 0,
        ),
        messages,
    };
}

export async function getSimpleChatMessagesFromEnd(
    context: RequestContext,
    {
        simpleChatId,
        limit,
        afterMessageIndex,
        beforeMessageIndex,
    }: {
        simpleChatId: SimpleChatId;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
): Promise<{
    messageCount: number;
    messages: Array<SimpleChatMessageModel>;
}> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable =
        typeof beforeMessageIndex !== "number" || beforeMessageIndex > 0
            ? SimpleChatTable.query(context, {
                  startKey: {
                      partitionType: "SimpleChat",
                      sortRangeType: "Messages",
                      simpleChatId,
                      messageIndex:
                          typeof afterMessageIndex === "number" ? afterMessageIndex + 1 : 0,
                  },
                  endKey: {
                      partitionType: "SimpleChat",
                      sortRangeType: "Messages",
                      simpleChatId,
                      messageIndex:
                          typeof beforeMessageIndex === "number"
                              ? beforeMessageIndex - 1
                              : Number.MAX_SAFE_INTEGER,
                  },
                  limit,
                  // Scan backwards from `endKey` to `startKey` so we can get messages at the end
                  // instead of start.
                  descending: true,
              })
            : (async function* () {})();

    const simpleChat = await getSimpleChat(context, simpleChatId);
    if (!simpleChat) throw new NotFoundError("Simple chat not found");

    const messages = await parallelMapAsyncIterableToArray(queryIterable, item =>
        createSimpleChatMessageModelFromItem(context, simpleChat.spaceId, item),
    );

    // We queried in descending order so put comments back in the right order.
    messages.reverse();

    return {
        // Make sure `messageCount` is consistent with `messages` in case of eventual
        // consistency race conditions.
        messageCount: Math.max(
            simpleChat.messageCount,
            messages.length > 0 ? messages[messages.length - 1]!.index + 1 : 0,
        ),
        messages,
    };
}
