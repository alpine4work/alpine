import {AccountEmailAddressIndex} from "~/server/accounts/internal/accounts_table.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {Context} from "~/shared/context/context.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get the email address added most recently to an account.
 *
 * You should use `getLatestEmailAddress()` in `spaces_table.ts` instead since it
 * authorizes that the actor is allowed to read the account's email addresses.
 */
export async function internalGetLatestEmailAddressByAccountIdWithoutAuthorization(
    context: Context<DynamoContextModules & {actor: ActorContextModule}>,
    accountId: AccountId,
) {
    const emailAddressItems = await arrayFromAsyncIterable(
        AccountEmailAddressIndex.query(context, {
            partitionKey: {accountId},
            limit: 1,
        }),
    );
    return emailAddressItems[0]?.emailAddress ?? null;
}
