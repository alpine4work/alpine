import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getAccountItemIfExists} from "~/server/accounts/internal/get_account_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {DataLossError, InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

export async function getSessionIfExists(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    sessionId: SessionId,
    // Optional: As an optimization you may include the account the session is for
    // so you load both the session data and account data in parallel. If you pass
    // in the wrong account ID for the session an error will be thrown.
    sessionAccountId: AccountId | null,
): Promise<{
    readonly id: SessionId;
    readonly accountId: AccountId;
    readonly createdTime: Date;
} | null> {
    const [sessionItem, accountItem] = await runAllPromises([
        AccountsTable.getItemIfExists(context, {
            partitionType: "Session",
            sortRangeType: "Attributes",
            sessionId,
        }).then(sessionItem => {
            if (sessionItem) return sessionItem;

            // Try loading the session item again with strong consistency if we couldn't
            // find it the first time instead of throwing a "you don't have access to
            // Alpine" error.
            return AccountsTable.getItemIfExists(
                context,
                {
                    partitionType: "Session",
                    sortRangeType: "Attributes",
                    sessionId,
                },
                {consistency: "Strong"},
            );
        }),

        // Preload the session account item and its avatar. This will populate the
        // `ContextCache` for the account item so when we load it later it's
        // immediately available.
        //
        // TODO(calebmer): Is this a useful optimization anymore? It may be a useful
        // optimization when React server side rendering but not when executing an RPC
        // (when we don't need the account avatar).
        sessionAccountId ? getAccountItemIfExists(context, sessionAccountId) : null,
    ]);

    if (!sessionItem) return null;

    if (sessionAccountId) {
        if (sessionItem.accountId !== sessionAccountId)
            throw new PermissionDeniedError("Wrong `AccountId` for session");

        if (!accountItem)
            throw new InternalError("Expected account referenced by session to exist");

        // Sanity check: We shouldn't create sessions for bots. Only for accounts that
        // can sign in via email or some other method. Therefore we shouldn't be
        // reading a bot session account.
        if (accountItem.bot) {
            throw new DataLossError("Bot accounts can’t have sessions");
        }
    }

    return {
        id: sessionId,
        accountId: sessionItem.accountId,
        createdTime: sessionItem.createdTime,
    };
}
