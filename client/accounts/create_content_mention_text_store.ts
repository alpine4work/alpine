import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";

/**
 * Get the text to display for a content mention.
 */
export function createContentMentionTextStore(
    accountRegistry: AccountRegistry,
    references: ContentReferences,
    mention: ContentMention,
): Store<string> {
    if (mention.type !== "Account") {
        throw new UnimplementedError("Implemented in next PR");
    }

    const account = references.accountById.get(mention.accountId);

    if (!account) return new ConstStore(missingAccountName);

    return accountRegistry.getAccountStore(account).map(accountData => {
        const accountName = mention.isShort
            ? getAccountShortNameWithoutFullNameTooltip(accountData)
            : accountData.name;

        // Replace spaces in the account name with no-break spaces. We want the entire
        // pill to stay together and not wrap when we reach the end of a line of text.
        //
        // https://graphemica.com/%C2%A0
        return accountName.replace(/\s/g, "\u00A0");
    });
}
