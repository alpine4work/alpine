import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {
    createGlobalContext,
    getGlobalContext,
    useGlobalContext,
} from "~/client/web/helpers/global_context.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

const AccountRegistryContext = createGlobalContext(() => new Map<SpaceId, AccountRegistry>());

/**
 * On the client you have global access to the account registry. Not just access
 * through React context.
 *
 * If the global registry hasn't been initialized yet (since a context provider
 * component hasn't mounted) then calling this function will initialize it.
 *
 * Will throw an error if we're not running in a web browser.
 */
export function getAccountRegistry(spaceId: SpaceId): AccountRegistry {
    return getOrSetDefaultMapValue(
        getGlobalContext(AccountRegistryContext),
        spaceId,
        () => new AccountRegistry(),
    );
}

/**
 * Gets the account registry for our app. Used to normalize our presentation of
 * accounts on the client even when we've loaded different data objects for the
 * accounts.
 *
 * If we're in a web browser we have one global registry instance.
 */
export function useAccountRegistry(): AccountRegistry {
    const {space} = useSpaceContext();

    return getOrSetDefaultMapValue(
        useGlobalContext(AccountRegistryContext),
        space.id,
        () => new AccountRegistry(),
    );
}

export function useAccountRegistryForSpaceId(spaceId: SpaceId): AccountRegistry {
    return getOrSetDefaultMapValue(
        useGlobalContext(AccountRegistryContext),
        spaceId,
        () => new AccountRegistry(),
    );
}

/**
 * Returns up-to-date data for the provided account that's the same as everywhere
 * else the account is presented. If we observe the account's data change this hook
 * will re-render with the new data.
 */
export function useAccountModel(account: AccountModel): AccountModelData;
export function useAccountModel<Value>(account: AccountModel | Value): AccountModelData | Value;
export function useAccountModel<Value>(account: AccountModel | Value): AccountModelData | Value {
    const accountRegistry = useAccountRegistry();

    const accountData = useStore(
        account instanceof AccountModel ? accountRegistry.getAccountStore(account) : null,
    );

    if (accountData === null) {
        return account as Value;
    } else {
        return accountData;
    }
}
