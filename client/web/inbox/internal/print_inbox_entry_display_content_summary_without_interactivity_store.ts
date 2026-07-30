import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {InboxEntryDisplayContentTitle} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {printInboxEntryDisplayContentTitleAsText} from "~/shared/notifications/print_inbox_entry_display_content_title_as_text.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

/**
 * Reactive variant of `printInboxEntryDisplayContentTitleAsText()` that subscribes
 * to live account data via `accountRegistry` so the produced string updates when
 * an account's name changes.
 */
export function printInboxEntryDisplayContentSummaryWithoutInteractivityStore(
    accountRegistry: AccountRegistry,
    title: InboxEntryDisplayContentTitle,
): Store<string> {
    return computeStore(get =>
        printInboxEntryDisplayContentTitleAsText(title, account =>
            get(accountRegistry.getAccountStore(account)),
        ),
    );
}
