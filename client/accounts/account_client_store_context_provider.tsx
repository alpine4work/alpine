import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {createGlobalContext, useGlobalContext} from "~/client/helpers/global_context.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";
import {assert} from "~/shared/helpers/control/assert.js";

let accountClientStoreForClient: AccountClientStore | null = null;

const AccountClientStoreContext = createGlobalContext(() => {
    // On the server, there is no global access to the task realtime client.
    if (typeof window === "undefined") {
        return new AccountClientStore();
    } else {
        accountClientStoreForClient ??= new AccountClientStore();
        return accountClientStoreForClient;
    }
});

/**
 * On the client you have global access the account client store. Not just
 * access through React context.
 *
 * If the global client store hasn't been initialized yet (since a context
 * provider component hasn't mounted) then calling this function will
 * initialize it.
 *
 * Will throw an error if we're not running in a web browser.
 */
export function getAccountClientStoreForClient(): AccountClientStore {
    assert(typeof window !== "undefined");

    accountClientStoreForClient ??= new AccountClientStore();
    return accountClientStoreForClient;
}

/**
 * Gets the account client store for our app. Used to normalize our presentation of
 * accounts on the client even when we've loaded different data objects for the
 * accounts.
 *
 * If we're in a web browser we have one global store instance.
 */
export function useAccountClientStore(): AccountClientStore {
    return useGlobalContext(AccountClientStoreContext);
}

/**
 * Returns up-to-date data for the provided account that's the same as
 * everywhere else the account is presented. If we observe the account's data
 * change this hook will re-render with the new data.
 */
export function useAccountModel(account: AccountModel | AccountModelData): AccountModelData {
    const store = useAccountClientStore();

    const accountData = useStore(
        account instanceof AccountModel ? store.getAccountStore(account) : null,
    );

    if (accountData === null) {
        return account as AccountModelData;
    } else {
        return accountData;
    }
}
