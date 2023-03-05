import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name";
import {ContentMention, missingAccountContentMentionName} from "~/shared/content/content_mention";
import {ContentReferences} from "~/shared/models/content_references";

/**
 * Get the text to display for a content mention.
 */
export function getContentMentionText(
    references: ContentReferences,
    mention: ContentMention,
): string {
    const account = references.accountById.get(mention.accountId);
    const accountName = account
        ? getAccountShortNameWithoutFullNameTooltip(account)
        : missingAccountContentMentionName;

    // Replace spaces in the account name with no-break spaces. We want the entire
    // pill to stay together and not wrap when we reach the end of a line of text.
    //
    // https://graphemica.com/%C2%A0
    return accountName.replace(/\s/g, "\u00A0");
}
