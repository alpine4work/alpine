import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {InboxEntryDisplayContentTitle} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Print `InboxEntryDisplayContentTitle` to a plain text string without any
 * interactivity or embellishment (e.g. account names are not in bold).
 *
 * Pass `getAccountData` to resolve each account reference. Non-reactive callers
 * (server, tests) typically pass `(account) => account.initialData`. Reactive
 * client callers should wrap an `AccountRegistry` lookup so the rendered string
 * tracks live account data updates.
 */
export function printInboxEntryDisplayContentTitleAsText(
    title: InboxEntryDisplayContentTitle,
    getAccountData: (account: AccountModel) => Pick<AccountModelWithoutSpaceData, "name">,
): string {
    let text = "";
    for (const item of title) {
        if (typeof item === "string") {
            text += item;
        } else {
            text += getAccountShortNameWithoutFullNameTooltip(getAccountData(item));
        }
    }
    return text;
}
