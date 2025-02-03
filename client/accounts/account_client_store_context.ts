import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {
    createGlobalContext,
    getGlobalContext,
    useGlobalContext,
} from "~/client/helpers/global_context.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

const AccountClientStoreContext = createGlobalContext(() => new Map<SpaceId, AccountClientStore>());

/**
 * On the client you have global access to the account client store. Not just
 * access through React context.
 *
 * If the global client store hasn't been initialized yet (since a context
 * provider component hasn't mounted) then calling this function will
 * initialize it.
 *
 * Will throw an error if we're not running in a web browser.
 */
export function getAccountClientStore(spaceId: SpaceId): AccountClientStore {
    return getOrSetDefaultMapValue(
        getGlobalContext(AccountClientStoreContext),
        spaceId,
        () => new AccountClientStore(),
    );
}

/**
 * Gets the account client store for our app. Used to normalize our presentation of
 * accounts on the client even when we've loaded different data objects for the
 * accounts.
 *
 * If we're in a web browser we have one global store instance.
 */
export function useAccountClientStore(): AccountClientStore {
    const {space} = useSpaceContext();

    return getOrSetDefaultMapValue(
        useGlobalContext(AccountClientStoreContext),
        space.id,
        () => new AccountClientStore(),
    );
}

export function useAccountClientStoreForSpaceId(spaceId: SpaceId): AccountClientStore {
    return getOrSetDefaultMapValue(
        useGlobalContext(AccountClientStoreContext),
        spaceId,
        () => new AccountClientStore(),
    );
}

/**
 * Returns up-to-date data for the provided account that's the same as
 * everywhere else the account is presented. If we observe the account's data
 * change this hook will re-render with the new data.
 */
export function useAccountModel(account: AccountModel | AccountModelData): AccountModelData;
export function useAccountModel(
    account: AccountModel | AccountModelData | null,
): AccountModelData | null;
export function useAccountModel(
    account: AccountModel | AccountModelData | null,
): AccountModelData | null {
    const store = useAccountClientStore();

    const accountData = useStore(
        account instanceof AccountModel ? store.getAccountStore(account) : null,
    );

    if (accountData === null) {
        return account as AccountModelData | null;
    } else {
        return accountData;
    }
}
