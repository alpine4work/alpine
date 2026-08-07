import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {parseAccountNameAssumingWesternNameOrder} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.open_source.js";

export function getAccountInitials(accountData: AccountModelWithoutSpaceData) {
    // TODO(calebmer): If we ever support eastern name order of family name first then
    // given name, the initials should preserve that order. We shouldn't put the given
    // name initial first.
    const {givenName, familyName} = parseAccountNameAssumingWesternNameOrder(accountData.name);

    // We use iterators instead of indexing into the name because iterators give us
    // full Unicode unicode code points. This means grapheme clusters will be split,
    // but surrogate pairs will be preserved.
    //
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/@@iterator
    const firstInitial: string = iterateGraphemes(givenName).next().value;
    const lastInitial: string | null = familyName
        ? iterateGraphemes(familyName).next().value
        : null;

    return {firstInitial, lastInitial};
}
