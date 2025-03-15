import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Enable browser spellcheck for David Gerrells (david.gerrells2@gmail.com) who
 * asked for spellcheck to be enabled. We believe the right solution for
 * spellcheck is to implement our own spellchecker so that it can be integrated
 * in our custom right click menu. And since we know the domain we can avoid
 * marking industry terms as misspelled.
 */
export function isBrowserSpellcheckEnabled(currentAccountId: AccountId | undefined): boolean {
    return currentAccountId === "5n77gg00wpxtcn065etfa6p4g0";
}
