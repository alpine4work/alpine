import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {scheduleTryOnDesktopEmailDelaySeconds} from "~/server/accounts/schedule_try_on_desktop_email.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";

export async function optOutOfTryOnDesktopEmail(context: ServerSessionActionContext) {
    await AccountsTable.createOrReplaceItem(context, {
        partitionType: "TryOnDesktopEmailOptOut",
        sortRangeType: "Attributes",
        accountId: context.actor.getAccountId(),
        // Expire the opt out item after 5 minutes (plus one second to account for
        // clock skew). By that point the try on desktop email should've been sent.
        expirationTime: new Date(Date.now() + (scheduleTryOnDesktopEmailDelaySeconds + 1) * 1000),
    });
}
