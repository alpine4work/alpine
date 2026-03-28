import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {
    evaluateAccessPolicy,
    evaluateAccessPolicyForAccount,
} from "~/server/access/evaluate_access_policy.js";
import {ChatAttributesItem} from "~/server/chat/data/internal/chat_table.js";
import {getChatAccountItemIfExistsForAuthorization} from "~/server/chat/data/internal/get_chat_account_item_for_authorization.js";
import {getChatAttributesItemForAuthorization} from "~/server/chat/data/internal/get_chat_attributes_item_for_authorization.js";
import {getChatItemForAuthorization} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {
    AccessLevel,
    AccessPolicy,
    ResolvedAccessPolicy,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {chatPermissionDeniedErrorDisplayMessageByAccessLevel} from "~/shared/chat/chat_error_messages.js";
import {ErrorBase, PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {AccountId, ChatId, SiteId} from "~/shared/id/types/id_types.js";

export async function authorizeChatAccessAndReturnItem(
    context: ServerActionContext,
    chatId: ChatId,
    expectedAccessLevel: AccessLevel,
    options?: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<ChatAttributesItem> {
    return unwrapResult(
        await authorizeChatAccessAndReturnItemIfPossible(
            context,
            chatId,
            expectedAccessLevel,
            options,
        ),
    );
}

export async function authorizeChatAccessAndReturnItemIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    expectedAccessLevel: AccessLevel,
    options?: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<Result<ChatAttributesItem, ErrorBase>> {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            const result = await authorizeChatAccessForAccountAndReturnItemIfPossible(
                context,
                chatId,
                context.actor.getAccountId(),
                expectedAccessLevel,
                options,
            );
            return mapResult(result, ({attributesItem}) => attributesItem);
        }

        // If we have access to the space, we have access to the chat...
        case "System": {
            const attributesItem = await getChatAttributesItemForAuthorization(
                context,
                chatId,
                options,
            );
            const result = await authorizeSpaceAccessIfPossible(context, attributesItem.spaceId);
            if (!result.ok) return result;
            return {ok: true, value: attributesItem};
        }

        case "Anonymous": {
            const chatItem = await getChatItemForAuthorization(context, chatId, options);

            switch (chatItem.attributesItem.definition.type) {
                case "Direct": {
                    return {ok: false, error: unauthenticatedSessionError()};
                }
                case "Room": {
                    if (
                        await evaluateAccessPolicy(
                            context,
                            chatItem.attributesItem.spaceId,
                            chatItem.attributesItem.definition.accessPolicy,
                            expectedAccessLevel,
                        )
                    ) {
                        return {ok: true, value: chatItem.attributesItem};
                    }
                    return {ok: false, error: unauthenticatedSessionError()};
                }
                default:
                    throw exhaustive(chatItem.attributesItem.definition);
            }
        }

        case "Bot": {
            const botAccountId = context.actor.getBotAccountId();
            const chatItem = await getChatItemForAuthorization(context, chatId, options);

            const accessPolicy: AccessPolicy | ResolvedAccessPolicy =
                chatItem.attributesItem.definition.type !== "Direct"
                    ? chatItem.attributesItem.definition.accessPolicy
                    : {
                          type: "Local",
                          accountGrantById: new Map(
                              chatItem.accountItems.map(({accountId}) => [
                                  accountId,
                                  {level: "Manage"},
                              ]),
                          ),
                          defaultGrant: null,
                          urlGrant: null,
                      };

            const ok = await evaluateAccessPolicy(
                context,
                chatItem.attributesItem.spaceId,
                accessPolicy,
                expectedAccessLevel,
                options,
            );

            if (!ok) {
                return {
                    ok: false,
                    error: await createAccessPolicyPermissionDeniedError(context, {
                        spaceId: chatItem.attributesItem.spaceId,
                        expectedAccessLevel,
                        aggregateDedupeKey: chatId,
                        displayMessages: chatPermissionDeniedErrorDisplayMessageByAccessLevel,
                    }),
                };
            }

            // Special case: we don't allow bots to send messages in direct chats where the bot
            // isn't a member (even if the bot's scope would otherwise allow it). Bots can't
            // "pop in" to 1:1 chats (even if they can view the messages in 1:1 chats). You
            // must explicitly add a bot to a chat for it to send a message to that chat.
            if (
                hasAccessLevel(expectedAccessLevel, "Comment") &&
                chatItem.attributesItem.definition.type === "Direct" &&
                chatItem.accountItems.every(accountItem => accountItem.accountId !== botAccountId)
            ) {
                return {
                    ok: false,
                    error: new PermissionDeniedError(
                        "Bot can only view messages in chat it\u2019s not a member of",
                        {
                            displayMessage: errorDisplayMessage`Can\u2019t create messages in chat the bot isn\u2019t a member of. Try creating a new chat that includes the bot and send a message to that chat.`,
                        },
                    ),
                };
            }

            return {ok: true, value: chatItem.attributesItem};
        }

        default:
            throw exhaustive(context.actor);
    }
}

export async function authorizeChatAccessForAccountAndReturnItem(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    expectedAccessLevel: AccessLevel,
    options?: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<{attributesItem: ChatAttributesItem; definition: ChatDefinitionForAuthorization}> {
    return unwrapResult(
        await authorizeChatAccessForAccountAndReturnItemIfPossible(
            context,
            chatId,
            accountId,
            expectedAccessLevel,
            options,
        ),
    );
}

export type ChatDefinitionForAuthorization =
    | {
          readonly type: "Direct";
          readonly accountCount: number;
      }
    | {
          readonly type: "Room";
          readonly name: string;
      };

export async function authorizeChatAccessForAccountAndReturnItemIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    expectedAccessLevel: AccessLevel,
    options?: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<
    Result<
        {attributesItem: ChatAttributesItem; definition: ChatDefinitionForAuthorization},
        ErrorBase
    >
> {
    let chatAttributesItem: ChatAttributesItem;

    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            // We already are loading our session's chat account item above.
            if (context.actor.getAccountId() === accountId) {
                const attributesItem = await getChatAttributesItemForAuthorization(
                    context,
                    chatId,
                    options,
                );

                // Throw if actor doesn't have access to the chat. We only return a `Result` when
                // the account we're checking doesn't have access to the chat.
                const result = await authorizeSpaceAccessIfPossible(
                    context,
                    attributesItem.spaceId,
                );
                if (!result.ok) return result;
                chatAttributesItem = attributesItem;
                break;
            }

            // Intentionally fallthrough...
        }
        case "System":
        case "Anonymous":
        case "Bot": {
            // Throw if actor doesn't have access to the chat. We only return a `Result` when
            // the account we're checking doesn't have access to the chat. The inner call emits
            // `onSiteId` via the underlying chat-item / attributes-item loaders.
            const attributesItem = unwrapResult(
                await authorizeChatAccessAndReturnItemIfPossible(
                    context,
                    chatId,
                    expectedAccessLevel,
                    options,
                ),
            );

            // Make sure the account is a member of the space. If the account was removed from
            // the space then we want to return a `PermissionDeniedError`.
            if (!(await isAccountMemberOfSpace(context, attributesItem.spaceId, accountId))) {
                return {
                    ok: false,
                    error: new PermissionDeniedError("Account isn\u2019t a member of space"),
                };
            }

            chatAttributesItem = attributesItem;
            break;
        }
        default:
            throw exhaustive(context.actor);
    }

    switch (chatAttributesItem.definition.type) {
        case "Direct": {
            // Optimization: If this is a 1:1 chat we have the `AccountId`s available in the
            // chat attributes item. Otherwise we need to load the `chatAccountItem` from the
            // database.
            //
            // Most of the time `getChatAccountItemIfExistsForAuthorization()` returns a cached
            // value and doesn't make a database call. Since if you've called
            // `getChatItemForAuthorization()` beforehand (`getChat()`, `getChatDefinition()`,
            // etc. do this) then we've already cached all account items for the chat.
            if (chatAttributesItem.accountIdsForDirectOneOnOne) {
                if (!chatAttributesItem.accountIdsForDirectOneOnOne.includes(accountId)) {
                    return {
                        ok: false,
                        error: await createAccessPolicyPermissionDeniedError(context, {
                            spaceId: chatAttributesItem.spaceId,
                            expectedAccessLevel,
                            aggregateDedupeKey: `${chatId}:${accountId}`,
                            displayMessages: chatPermissionDeniedErrorDisplayMessageByAccessLevel,
                        }),
                    };
                }

                // We don't check `expectedAccessLevel` since all direct chat accounts have
                // `Manage` access.
                return {
                    ok: true,
                    value: {
                        attributesItem: chatAttributesItem,
                        definition: {type: "Direct", accountCount: 2},
                    },
                };
            } else {
                const chatAccountItem = await getChatAccountItemIfExistsForAuthorization(
                    context,
                    chatId,
                    accountId,
                    options,
                );

                if (!chatAccountItem) {
                    return {
                        ok: false,
                        error: await createAccessPolicyPermissionDeniedError(context, {
                            spaceId: chatAttributesItem.spaceId,
                            expectedAccessLevel,
                            aggregateDedupeKey: `${chatId}:${accountId}`,
                            displayMessages: chatPermissionDeniedErrorDisplayMessageByAccessLevel,
                        }),
                    };
                }

                // We don't check `expectedAccessLevel` since all direct chat accounts have
                // `Manage` access.
                return {
                    ok: true,
                    value: {
                        attributesItem: chatAttributesItem,
                        definition: {
                            type: "Direct",
                            accountCount: chatAccountItem.chatAccountCount,
                        },
                    },
                };
            }
        }
        case "Room": {
            const ok = await evaluateAccessPolicyForAccount(
                context,
                chatAttributesItem.spaceId,
                accountId,
                chatAttributesItem.definition.accessPolicy,
                expectedAccessLevel,
                options,
            );

            if (!ok) {
                return {
                    ok: false,
                    error: await createAccessPolicyPermissionDeniedError(context, {
                        spaceId: chatAttributesItem.spaceId,
                        expectedAccessLevel,
                        aggregateDedupeKey: `${chatId}:${accountId}`,
                        displayMessages: chatPermissionDeniedErrorDisplayMessageByAccessLevel,
                    }),
                };
            }

            return {
                ok: true,
                value: {
                    attributesItem: chatAttributesItem,
                    definition: chatAttributesItem.definition,
                },
            };
        }
        default:
            throw exhaustive(chatAttributesItem.definition);
    }
}
