import {intoAccessPolicyModel} from "~/server/access/into_access_policy_model.js";
import {getChatMessageCount} from "~/server/chat/data/get_chat_message_count.js";
import {getChatSearchEntityContributorIds} from "~/server/chat/data/get_chat_search_entity_contributor_ids.js";
import {getRoomChatPreviewAccountIds} from "~/server/chat/data/get_room_chat_preview_account_ids.js";
import {ChatItem} from "~/server/chat/data/internal/chat_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getAccountOrDangerouslyGetStubWithoutAuthorization} from "~/server/spaces/get_account_or_dangerously_get_stub_without_authoriztion.js";
import {ChatModel, ChatModelDefinition} from "~/shared/chat/chat_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export async function createChatModelFromItem(
    context: ServerActionContext,
    chatItem: ChatItem,
): Promise<ChatModel> {
    let definition: ChatModelDefinition;

    switch (chatItem.attributesItem.definition.type) {
        case "Direct": {
            definition = {
                type: "Direct",
                accounts: await runAllPromises(
                    chatItem.accountItems.map(chatAccountItem =>
                        getAccount(
                            context,
                            chatItem.attributesItem.spaceId,
                            chatAccountItem.accountId,
                        ),
                    ),
                ).then(accounts =>
                    accounts.sort((account1, account2) =>
                        account1.initialData.name.localeCompare(
                            account2.initialData.name,
                            defaultLocale,
                        ),
                    ),
                ),
            };
            break;
        }
        case "Room": {
            const originalPreviewAccountIds = getRoomChatPreviewAccountIds(
                chatItem.attributesItem.chatId,
                chatItem.attributesItem.definition.creatorId,
                getChatSearchEntityContributorIds(
                    chatItem.attributesItem.definition,
                    chatItem.attributesItem.messagesSummary,
                ),
            );

            const sortAccountIdLast = (accountId: AccountId) => {
                switch (context.actor.type) {
                    case "System":
                    case "Anonymous":
                    case "Bot": {
                        return false;
                    }
                    case "Session":
                    case "ImpersonatedAccount": {
                        return accountId === context.actor.getAccountId();
                    }
                    default:
                        throw exhaustive(context.actor);
                }
            };

            // Show two accounts that aren't our actor's account. We randomly show two
            // different accounts for every chat (shuffling done in
            // `originalPreviewAccountIds`) to try and help make different chats appear
            // differently.
            //
            // If there are only two accounts then we'll show our actor account but we'll show
            // it last.
            const previewAccountIds = Array.from(originalPreviewAccountIds)
                .sort((accountId1, accountId2) => {
                    const sortAccountId1Last = sortAccountIdLast(accountId1);
                    const sortAccountId2Last = sortAccountIdLast(accountId2);

                    if (sortAccountId1Last && sortAccountId2Last) return 0;
                    if (sortAccountId1Last) return 1;
                    if (sortAccountId2Last) return -1;

                    return 0;
                })
                .slice(0, 2);

            const [previewAccounts, accessPolicy] = await runAllPromises([
                runAllPromises(
                    mapIterable(previewAccountIds, accountId =>
                        getAccountOrDangerouslyGetStubWithoutAuthorization(
                            context,
                            chatItem.attributesItem.spaceId,
                            accountId,
                        ),
                    ),
                ),
                intoAccessPolicyModel(context, chatItem.attributesItem.definition.accessPolicy),
            ]);

            definition = {
                type: "Room",
                name: chatItem.attributesItem.definition.name,
                accessPolicy,
                previewAccounts,
            };
            break;
        }
        default:
            throw exhaustive(chatItem.attributesItem.definition);
    }

    return new ChatModel({
        id: chatItem.attributesItem.chatId,
        version: chatItem.attributesItem.updateLockVersion ?? 0,
        spaceId: chatItem.attributesItem.spaceId,
        createdTime: chatItem.attributesItem.createdTime,
        definition,
        messageCount: getChatMessageCount(chatItem.attributesItem.messagesSummary),
    });
}
