import {subHours} from "date-fns";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {EmailAddress} from "~/server/emails/email_address.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Rewind an email address's one time password sign in state by some number of
 * hours. This allows us to test cases where time has passed after the user
 * tried to sign in.
 */
export async function rewindAccountEmailAddressOneTimePasswordSignInStateTimeForTest(
    context: DynamoContext,
    emailAddress: EmailAddress,
    hours: number,
) {
    assert(process.env.NODE_ENV === "test");

    await AccountsTable.updateItem(
        context,
        {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        },
        accountEmailAddressItem => {
            assert(accountEmailAddressItem?.oneTimePasswordSignInState);

            return {
                ...accountEmailAddressItem,
                oneTimePasswordSignInState: {
                    ...accountEmailAddressItem.oneTimePasswordSignInState,
                    generatedTime: subHours(
                        accountEmailAddressItem.oneTimePasswordSignInState.generatedTime,
                        hours,
                    ),
                    lastFailedAttemptTime: accountEmailAddressItem.oneTimePasswordSignInState
                        .lastFailedAttemptTime
                        ? subHours(
                              accountEmailAddressItem.oneTimePasswordSignInState
                                  .lastFailedAttemptTime,
                              hours,
                          )
                        : null,
                },
            };
        },
    );
}
