import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Shorter version of the account's name. If the account has a name formatted
 * like most English names this will just be the first name. We may allow this
 * to be configurable in the future.
 *
 * If you're building client UI, you should use the `<AccountShortName>`
 * component which comes with a tooltip that shows the account's full name on
 * hover. Account short names may not be reliable so it's important to give the
 * user access to the account's full name.
 */
export function getAccountShortNameWithoutFullNameTooltip(
    accountData: Omit<AccountModelWithoutSpaceData, "avatar">,
): string {
    const {givenName} = parseAccountNameAssumingWesternNameOrder(accountData.name);
    return givenName;
}

/**
 * Parse an account name into smaller pieces. We use this to summarize an
 * account in a shorter way than their full name.
 *
 * This makes assumptions about the shape of names that may not always hold!
 * You have to be careful using this function. It assumes names use the
 * [western name order][1] of given name then family name (with optional middle
 * name or initial). Pseudonyms might not use this style and names from other
 * cultures in different languages might not use this style.
 *
 * We will likely have to continually update this function as we learn about
 * new ways of writing names. Eventually teaching it about locale and maybe
 * even making it customizable.
 *
 * [1]: https://en.wikipedia.org/wiki/Personal_name#Western_name_order
 */
export function parseAccountNameAssumingWesternNameOrder(accountName: string): {
    givenName: string;
    familyName: string | null;
} {
    assert(accountName.length > 0);
    const nameParts = accountName.split(/\p{White_Space}/u);
    assert(nameParts.length > 0);
    const givenName = nameParts[0]!;
    const familyName = nameParts.length > 1 ? nameParts[nameParts.length - 1]! : null;

    return {givenName, familyName};
}
