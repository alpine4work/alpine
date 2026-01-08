import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";

// NOCOMMIT: Test for idempotence
export async function optInToTryOnDesktopEmail(context: ServerSessionActionContext) {
    await AccountsTable.deleteItemWithKeyIfExists(context, {
        partitionType: "TryOnDesktopEmailOptOut",
        sortRangeType: "Attributes",
        accountId: context.actor.getAccountId(),
    });
}
