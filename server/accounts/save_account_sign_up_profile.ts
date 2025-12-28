import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getAccountItemWithoutAvatarWithEventualThenStrongConsistency} from "~/server/accounts/internal/get_account_item.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {Context} from "~/shared/context/context.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {ReactionCharacter} from "~/shared/reactions/reaction.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

export const saveAccountSignUpProfileBeforeExecuteTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Finish signing up an account by setting the `name` and `reactionCharacter`
 * chosen during sign up. This function may be called by anyone without
 * authorizing they own the account if `hasNotSignedUp` is true and the account
 * isn't a member of any spaces (`InvitePending` state is fine). This is
 * because we allow the user to set their name and reaction character before
 * entering the one time password sent to their email (which authorizes them).
 *
 * Once this function has been called, it can't be called again!
 */
export async function saveAccountSignUpProfile(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    {
        accountId,
        name,
        reactionCharacter,
    }: {
        accountId: AccountId;
        name: string;
        reactionCharacter: ReactionCharacter;
    },
) {
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    await context.dynamo.retryTransaction(async context => {
        const accountItem = await getAccountItemWithoutAvatarWithEventualThenStrongConsistency(
            context,
            accountId,
        );

        if (!accountItem.hasNotSignedUp) {
            throw new FailedPreconditionError("Account has already finished signing up", {
                displayMessage: errorDisplayMessage`You’ve already finished signing up. Try ${errorDisplayMessage.signInLink(
                    "signing in",
                )} instead.`,
            });
        }

        // We commit an update account name task action in all the spaces an account is in.
        const {isInNoSpaces, getConditionCheckTransactionEntry} =
            await context.spacesInjection.isAccountInNoSpaces(accountId);

        // Permissions check: Once the account has started joining spaces, we don't
        // allow them to use `saveAccountSignUpProfile()` to change their name anymore.
        //
        // This means we don't have to reindex the account in all its spaces like
        // `updateOurAccountName()` must do because the account isn't a member of any
        // spaces yet!
        if (!isInNoSpaces) {
            throw new PermissionDeniedError(
                "Can only finish account sign up when the account hasn’t joined any spaces (the account may have pending invites)",
            );
        }

        const nameVersion = accountItem.nameVersion + 1;

        const transactionEntries: Array<DynamoTransactionEntry> = [
            AccountsTable.transactionDirectlyUpdateItem({
                // Remove the `hasNotSignedUp` property. You won't be able to call
                // `saveAccountSignUpProfile()` on this account again.
                ...omitObject(accountItem, ["hasNotSignedUp"]),
                name,
                nameVersion,
                reactionCharacter,
            }),
        ];

        // Don't commit if the account's spaces changed without us knowing.
        {
            const transactionEntry = getConditionCheckTransactionEntry();
            if (transactionEntry) transactionEntries.push(transactionEntry);
        }

        await saveAccountSignUpProfileBeforeExecuteTestCheckpoint.waitForTest(accountId);

        await DynamoTableSchema.executeTransaction(context, transactionEntries);
    });
}
