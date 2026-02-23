import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {ChatAccountItem, ChatAttributesItem} from "~/server/chat/data/internal/chat_table.js";
import {getChatAccountItemIfExistsForAuthorization} from "~/server/chat/data/internal/get_chat_account_item_for_authorization.js";
import {getChatAttributesItemForAuthorization} from "~/server/chat/data/internal/get_chat_attributes_item_for_authorization.js";
import {getChatItemForAuthorization} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {AccessPolicyWithoutGenerations} from "~/shared/access/access_policy.js";
import {ErrorBase, PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {AccountId, ChatId} from "~/shared/id/types/id_types.js";

const chatPermissionDeniedErrorDisplayMessage = errorDisplayMessage`You don\u2019t have access to this chat.`;

export async function authorizeChatAccessAndReturnItem(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChatAttributesItem> {
    return unwrapResult(await authorizeChatAccessAndReturnItemIfPossible(context, chatId, options));
}

export async function authorizeChatAccessAndReturnItemIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<ChatAttributesItem, ErrorBase>> {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            const result = await authorizeChatAccessForAccountAndReturnItemsIfPossible(
                context,
                chatId,
                context.actor.getAccountId(),
                options,
            );
            return mapResult(result, ({chatAttributesItem}) => chatAttributesItem);
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
            return {ok: false, error: unauthenticatedSessionError()};
        }

        case "Bot": {
            const chatItem = await getChatItemForAuthorization(context, chatId, options);

            const accessPolicy: AccessPolicyWithoutGenerations = {
                accountGrantById: new Map(
                    chatItem.accountItems.map(({accountId}) => [accountId, {level: "Edit"}]),
                ),
                defaultGrant: null,
                urlGrant: null,
            };

            const ok = await evaluateAccessPolicy(
                context,
                chatItem.attributesItem.spaceId,
                accessPolicy,
                "Edit",
                options,
            );

            if (!ok) {
                return {
                    ok: false,
                    error: new PermissionDeniedError("Bot actor doesn\u2019t have access to chat", {
                        displayMessage: chatPermissionDeniedErrorDisplayMessage,
                    }),
                };
            }

            return {ok: true, value: chatItem.attributesItem};
        }

        default:
            throw exhaustive(context.actor);
    }
}

export async function authorizeChatAccessForAccountAndReturnItems(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{chatAttributesItem: ChatAttributesItem; chatAccountItem: ChatAccountItem}> {
    return unwrapResult(
        await authorizeChatAccessForAccountAndReturnItemsIfPossible(
            context,
            chatId,
            accountId,
            options,
        ),
    );
}

export async function authorizeChatAccessForAccountAndReturnItemsIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<
    Result<{chatAttributesItem: ChatAttributesItem; chatAccountItem: ChatAccountItem}, ErrorBase>
> {
    const [chatAttributesItemResult, chatAccountItem] = await runAllPromises([
        (async (): Promise<Result<ChatAttributesItem, ErrorBase>> => {
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

                        // Throw if actor doesn't have access to the chat. We only return a `Result`
                        // when the account we're checking doesn't have access to the chat.
                        const result = await authorizeSpaceAccessIfPossible(
                            context,
                            attributesItem.spaceId,
                        );
                        if (!result.ok) return result;
                        return {ok: true, value: attributesItem};
                    }

                    // Intentionally fallthrough...
                }
                case "System":
                case "Anonymous":
                case "Bot": {
                    // Throw if actor doesn't have access to the chat. We only return a `Result`
                    // when the account we're checking doesn't have access to the chat.
                    const attributesItem = unwrapResult(
                        await authorizeChatAccessAndReturnItemIfPossible(context, chatId, options),
                    );

                    // Make sure the account is a member of the space. If the account was removed
                    // from the space then we want to return a `PermissionDeniedError`.
                    if (
                        !(await isAccountMemberOfSpace(context, attributesItem.spaceId, accountId))
                    ) {
                        return {
                            ok: false,
                            error: new PermissionDeniedError(
                                "Account isn\u2019t a member of space",
                            ),
                        };
                    }

                    return {ok: true, value: attributesItem};
                }
                default:
                    throw exhaustive(context.actor);
            }
        })(),

        // Load the account we're authorizing. We intentionally put this second so if
        // we have a bot actor that loads the full account (with
        // `getChatItemForAuthorization()`) then we won't need to make a second request
        // here thanks to `getChatAccountItemIfExistsForAuthorization()` checking the
        // `getChatItemForAuthorization()` cache first.
        getChatAccountItemIfExistsForAuthorization(context, chatId, accountId, options),
    ]);

    if (!chatAttributesItemResult.ok) return chatAttributesItemResult;
    const chatAttributesItem = chatAttributesItemResult.value;

    if (!chatAccountItem) {
        return {
            ok: false,
            error: new PermissionDeniedError("Account doesn\u2019t have access to chat", {
                displayMessage: chatPermissionDeniedErrorDisplayMessage,
            }),
        };
    }

    return {ok: true, value: {chatAttributesItem, chatAccountItem}};
}
