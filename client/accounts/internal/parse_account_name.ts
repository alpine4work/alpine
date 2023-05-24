import {AccountModel} from "~/shared/accounts/account_model";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Parse an account name into smaller pieces. We use this to summarize an
 * account in a shorter way than their full name.
 *
 * This makes assumptions about the shape of names that may not always hold!
 * You have to be careful using this function. It assumes names use the
 * standard English style of first name then last name (with optional middle
 * name or initial). Pseudonyms might not use this style and names from other
 * cultures in different languages might not use this style.
 *
 * We will likely have to continually update this function as we learn about
 * new ways of writing names. Eventually teaching it about locale and maybe
 * even making it customizable.
 *
 * This function is in an `internal` folder to prevent widespread use. Instead
 * use our curated components with specific semantic meaning.
 */
export function parseAccountName(account: AccountModel): {
    firstName: string;
    lastName: string | null;
} {
    assert(account.name.length > 0);
    const nameParts = account.name.split(/\p{White_Space}/u);
    assert(nameParts.length > 0);
    const firstName = nameParts[0]!;
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1]! : null;

    return {firstName, lastName};
}
