import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {InboxEntryDisplayContentSummary} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

/**
 * Print `InboxEntryDisplaySummary` to a plain text string without any
 * interactivity or embellishment (e.g. account names are not in bold).
 */
export function printInboxEntryDisplayContentSummaryWithoutInteractivityStore(
    accountRegistry: AccountRegistry,
    summary: InboxEntryDisplayContentSummary,
): Store<string> {
    return computeStore(get => {
        let text = "";

        for (const summaryItem of summary) {
            if (typeof summaryItem === "string") {
                text += summaryItem;
            } else {
                text += getAccountShortNameWithoutFullNameTooltip(
                    get(accountRegistry.getAccountStore(summaryItem)),
                );
            }
        }

        return text;
    });
}
