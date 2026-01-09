import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export const scheduleTryOnDesktopEmailDelaySeconds = 5 * 60;

/**
 * Schedule the "try on desktop email" for five minutes in the future. At that
 * time the job will check if the account has opted out and will only send the
 * email if the account hasn't opted out.
 */
export async function scheduleTryOnDesktopEmail(
    context: ServerSessionActionContext,
    {emailAddress, openSpaceId}: {emailAddress: EmailAddress; openSpaceId: SpaceId | null},
) {
    const accountEmailAddressItem = await AccountsTable.getItemWithEventualThenStrongConsistency(
        context,
        {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        },
    );

    if (accountEmailAddressItem.accountId !== context.actor.getAccountId()) {
        throw new PermissionDeniedError(
            "Can’t schedule try on desktop email for a different account",
        );
    }

    await context.jobs.dangerouslySendMaintenance(
        {
            type: "SendTryOnDesktopEmail",
            accountId: accountEmailAddressItem.accountId,
            emailAddress,
            openSpaceId,
        },
        {delaySeconds: scheduleTryOnDesktopEmailDelaySeconds},
    );
}
