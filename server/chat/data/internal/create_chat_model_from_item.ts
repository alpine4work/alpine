import {ChatItem} from "~/server/chat/data/internal/chat_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {DataLossError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

export async function createChatModelFromItem(
    context: ServerActionContext,
    chatItem: ChatItem,
): Promise<ChatModel> {
    const accounts = await runAllPromises(
        chatItem.accountItems.map(chatAccountItem => {
            if (chatAccountItem.spaceId !== chatItem.attributesItem.spaceId) {
                throw new DataLossError(
                    "Expected chat account item to have same `SpaceId` as chat item",
                );
            }
            return getAccount(context, chatItem.attributesItem.spaceId, chatAccountItem.accountId);
        }),
    );

    return new ChatModel({
        id: chatItem.attributesItem.chatId,
        spaceId: chatItem.attributesItem.spaceId,
        createdTime: chatItem.attributesItem.createdTime,
        messageCount: chatItem.attributesItem.messagesSummary.messageCount,
        // NOTE(calebmer): Ideally we sort chat accounts by some kind of affinity to
        // the current account? That seems like a good default.
        accounts: accounts
            .slice()
            .sort((account1, account2) =>
                account1.initialData.name.localeCompare(account2.initialData.name),
            ),
    });
}
