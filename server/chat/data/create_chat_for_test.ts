import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Create a new chat with the provided accounts and no messages but only in test
 * environments. In the app we use `sendChatMessageToAccounts()` to create chats.
 */
export async function createChatForTest(
    context: ServerSessionActionContext,
    {
        id = generateId<ChatId>(),
        spaceId,
        otherAccountIds,
    }: {
        id?: ChatId;
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
    },
): Promise<{
    id: ChatId;
    createdTime: Date;
}> {
    assert(process.env.NODE_ENV === "test");

    const accountIds = Array.from(
        new Set([...otherAccountIds, context.actor.getAccountId()]),
    ).sort();

    // Make sure all accounts are members of the space the chat is being created in.
    const accounts = await runAllPromises(
        accountIds.map(accountId => getAccount(context, spaceId, accountId)),
    );

    if (accounts.every(account => account.botId)) {
        throw new PermissionDeniedError("Can\u2019t create a chat with only bot accounts");
    }

    // NOTE(calebmer): Our tests override `Date.now()` to mock a fake time. So use this
    // slightly awkward form to let tests mock different times for chat creation.
    const createdTime = new Date(Date.now());

    await DynamoTableSchema.executeTransaction(context, [
        ChatTable.transactionCreateItem({
            partitionType: "Chat",
            sortRangeType: "Attributes",
            chatId: id,
            spaceId,
            createdTime,
            definition: {type: "Direct"},
            accountIdsForDirectOneOnOne: accountIds.length === 2 ? accountIds : null,
            messagesSummary: {
                unknownAuthorMessageCount: 0,
                messageCountByAuthorId: new Map(),
                mentionCountByAccountId: new Map(),
            },
        }),
        ...Array.from(accountIds, accountId =>
            ChatTable.transactionCreateOrReplaceItem({
                partitionType: "Chat",
                sortRangeType: "Account",
                spaceId,
                chatId: id,
                accountId,
                joinedTime: createdTime,
                chatAccountCount: accountIds.length,
            }),
        ),
    ]);

    return {
        id,
        createdTime,
    };
}
