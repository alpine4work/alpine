import {
    authorizeChatAccessAndReturnItemIfPossible,
    authorizeChatAccessForAccountAndReturnItemsIfPossible,
} from "~/server/chat/data/internal/authorize_chat_access_and_return_item.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ErrorBase} from "~/shared/error/error.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Authorize that the current account is allowed to access the chat.
 *
 * Cached at the action level so multiple requests with the same `ChatId` in
 * the same action will only load data from the database once.
 */
export async function authorizeChatAccess(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId}> {
    return unwrapResult(await authorizeChatAccessIfPossible(context, chatId, options));
}

/**
 * Authorize that the current account is allowed to access the chat. Returns a
 * result if authorization fails instead of throwing.
 *
 * Cached at the action level so multiple requests with the same `ChatId` in
 * the same action will only load data from the database once.
 */
export async function authorizeChatAccessIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId}, ErrorBase>> {
    const result = await authorizeChatAccessAndReturnItemIfPossible(context, chatId, options);
    return mapResult(result, ({spaceId}) => ({spaceId}));
}

/**
 * Authorizes that the provided account has access to the chat.
 *
 * If this is a session context, we also check that our session's account has
 * access to the chat.
 *
 * Returns some data related to the chat that exists on the item's we
 * query for.
 */
export async function authorizeChatAccessForAccount(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId; chatAccountCount: number}> {
    return unwrapResult(
        await authorizeChatAccessForAccountIfPossible(context, chatId, accountId, options),
    );
}

/**
 * Authorizes that the provided account has access to the chat.
 *
 * If this is a session context, we also check that our session's account has
 * access to the chat.
 *
 * Returns some data related to the chat that exists on the item's we
 * query for.
 */
export async function authorizeChatAccessForAccountIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId; chatAccountCount: number}, ErrorBase>> {
    const result = await authorizeChatAccessForAccountAndReturnItemsIfPossible(
        context,
        chatId,
        accountId,
        options,
    );
    return mapResult(
        result,
        ({chatAttributesItem: {spaceId}, chatAccountItem: {chatAccountCount}}) => ({
            spaceId,
            chatAccountCount,
        }),
    );
}
