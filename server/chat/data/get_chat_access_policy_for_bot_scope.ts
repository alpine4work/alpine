import {getChatItemForAuthorization} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerMinimalBotActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {AccessPolicyWithoutGenerations} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ChatId} from "~/shared/id/types/id_types.js";

/**
 * Load the chat's accounts for a bot scoped to the chat. Used when evaluating
 * whether a bot has permissions to certain resources.
 */
export async function getChatAccessPolicyForBotScope(
    context: ServerMinimalBotActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccessPolicyWithoutGenerations> {
    const scope = context.actor.getScope();
    if (scope.type !== "Chat" || scope.chatId !== chatId) {
        throw new PermissionDeniedError("Can only get `AccountId`s for the scoped chat");
    }

    const chatItem = await getChatItemForAuthorization(context, chatId, options);

    await authorizeSpaceAccess(context, chatItem.attributesItem.spaceId);

    switch (chatItem.attributesItem.definition.type) {
        case "Direct": {
            return {
                accountGrantById: new Map(
                    chatItem.accountItems.map(({accountId}) => [accountId, {level: "Manage"}]),
                ),
                defaultGrant: null,
                urlGrant: null,
            };
        }
        case "Room": {
            return chatItem.attributesItem.definition.accessPolicy;
        }
        default:
            throw exhaustive(chatItem.attributesItem.definition);
    }
}
