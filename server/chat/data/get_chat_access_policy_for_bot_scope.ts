import {intoEffectiveAccessPolicy} from "~/server/access/into_effective_access_policy.js";
import {getChatItemForAuthorization} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerMinimalBotActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {EffectiveAccessPolicy} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {ChatId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Load the chat's accounts for a bot scoped to the chat. Used when evaluating
 * whether a bot has permissions to certain resources.
 */
export async function getChatAccessPolicyForBotScope(
    context: ServerMinimalBotActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<EffectiveAccessPolicy> {
    const scope = context.actor.getScope();
    if (scope.type !== "Chat" || scope.chatId !== chatId) {
        throw new PermissionDeniedError("Can only get `AccountId`s for the scoped chat");
    }

    const chatItem = await getChatItemForAuthorization(context, chatId, options);

    const [, accessPolicy] = await runAllPromises([
        authorizeSpaceAccess(context, chatItem.attributesItem.spaceId),
        (async (): Promise<EffectiveAccessPolicy> => {
            switch (chatItem.attributesItem.definition.type) {
                case "Direct": {
                    return {
                        accountGrantById: new Map(
                            chatItem.accountItems.map(({accountId}) => [
                                accountId,
                                {level: "Manage"},
                            ]),
                        ),
                        defaultGrant: null,
                        urlGrant: null,
                    };
                }
                case "Room": {
                    return await intoEffectiveAccessPolicy(
                        context,
                        chatItem.attributesItem.definition.accessPolicy,
                    );
                }
                default:
                    throw exhaustive(chatItem.attributesItem.definition);
            }
        })(),
    ]);

    return accessPolicy;
}
