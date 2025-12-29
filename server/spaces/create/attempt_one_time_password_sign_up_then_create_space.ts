import {
    AttemptOneTimePasswordSignInOptions,
    attemptOneTimePasswordSignInWithAction,
} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {EmailAddress} from "~/server/emails/email_address.js";
import {createSpaceWelcomePackageTransactionEntries} from "~/server/spaces/create/internal/create_space_welcome_package_transaction_entries.js";
import {dangerouslyApplySpaceWelcomePackage} from "~/server/spaces/internal/dangerously_apply_space_welcome_package.js";
import {getAddSpaceAccountTransactionEntries} from "~/server/spaces/internal/get_add_space_account_transaction_entries.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Tries to sign in with the provided `oneTimePassword` and if that succeeds
 * then we create a personal space for the account.
 */
export async function attemptOneTimePasswordSignUpThenCreateSpace(
    context: ServerActionContext,
    emailAddress: EmailAddress,
    oneTimePassword: string,
    options: AttemptOneTimePasswordSignInOptions,
) {
    const [, {sessionId, sessionAccountId}] = await attemptOneTimePasswordSignInWithAction(
        context,
        emailAddress,
        oneTimePassword,
        options,
        async accountEmailAddressItem => {
            await context.dynamo.retryTransaction(async context => {
                const {accountId} = accountEmailAddressItem;
                const spaceId = generateId<SpaceId>();

                const currentTime = new Date();

                const [
                    accountResult,
                    {
                        transactionEntries: addSpaceAccountTransactionEntries,
                        accountVersionConditionCheckTransactionEntry,
                    },
                    {welcomePackageItem, transactionEntries: welcomePackageTransactionEntries},
                ] = await runAllPromises([
                    // NOTE(calebmer): We don't use a "without avatar" version of this function
                    // since:
                    //
                    // 1. There should be no avatar for the account at this point so we don't
                    //    actually pay any cost to try and load the avatar.
                    //
                    // 2. `getAddSpaceAccountTransactionEntries()` also loads the account with
                    //    avatar (other downstream functions of
                    //    `getAddSpaceAccountTransactionEntries()` need the avatar) so by loading
                    //    the account with avatar here it's already in cache and we can skip a
                    //    DynamoDB read in `getAddSpaceAccountTransactionEntries()`.
                    dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization(
                        context,
                        accountEmailAddressItem.accountId,
                        // Make sure we read the most recent account name which may have been written
                        // by `saveAccountSignUpProfile()`.
                        {consistency: "Strong"},
                    ),
                    getAddSpaceAccountTransactionEntries(context, {
                        currentTime,
                        space: {type: "New", id: spaceId},
                        account: {type: "Existing", id: accountId},
                        role: "Owner",
                    }),
                    createSpaceWelcomePackageTransactionEntries(context, {
                        currentTime,
                        ownerAccountId: accountId,
                        spaceId: spaceId,
                    }),
                ]);

                const {account, finishSignUpTransactionEntry} = assertExists(accountResult);

                // Account has already signed up! Don't bother creating spaces for the account.
                if (!finishSignUpTransactionEntry) return;

                const accountShortName = getAccountShortNameWithoutFullNameTooltip(
                    account.initialData,
                );

                const spaceNameSuffix = "’s Space";

                // Make sure `spaceName` is under the max label string length by slicing
                // `accountShortName` to a value that will fit with `spaceNameSuffix` added to
                // the end.
                const spaceName =
                    accountShortName.slice(0, maxLabelStringLength - spaceNameSuffix.length) +
                    spaceNameSuffix;

                const transactionEntries = [
                    SpacesTable.transactionCreateItem({
                        partitionType: "Space",
                        sortRangeType: "Attributes",
                        spaceId,
                        name: spaceName,
                        createdTime: currentTime,
                    }),
                    // `getAddSpaceAccountTransactionEntries()` adds a condition check transaction
                    // entry on the account. `finishSignUpTransactionEntry` should be our only
                    // transaction entry on the account.
                    ...addSpaceAccountTransactionEntries.filter(
                        entry => entry !== accountVersionConditionCheckTransactionEntry,
                    ),
                    ...welcomePackageTransactionEntries,
                ];

                transactionEntries.push(finishSignUpTransactionEntry);

                await runAllPromises([
                    DynamoTableSchema.executeTransaction(context, transactionEntries),

                    // Faster to add affinity points separately from our create space transaction.
                    // We don't care if there are some affinity point items floating around for a
                    // space that doesn't exist.
                    dangerouslyApplySpaceWelcomePackage(context, accountId, welcomePackageItem),
                ]);
            });
        },
    );

    return {sessionId, sessionAccountId};
}
