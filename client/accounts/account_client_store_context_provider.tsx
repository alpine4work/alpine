import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const AccountClientStoreContext = createContext<AccountClientStore | null>(null);

let accountClientStoreForClient: {isMounted: boolean; store: AccountClientStore} | null = null;

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

    if (accountClientStoreForClient === null) {
        accountClientStoreForClient = {isMounted: false, store: new AccountClientStore()};
    }

    return accountClientStoreForClient.store;
}

/**
 * Initializes the account client store and provides access through React
 * context for server-side rendering.
 */
export function AccountClientStoreContextProvider({children}: {children?: ReactNode}) {
    const [store] = useState(() => {
        // On the server, there is no global access to the task realtime client.
        if (typeof window === "undefined") {
            return new AccountClientStore();
        } else {
            // Reuse the existing store. Otherwise we need to create a new store.
            if (accountClientStoreForClient) return accountClientStoreForClient.store;

            const store = new AccountClientStore();
            accountClientStoreForClient = {isMounted: false, store};
            return store;
        }
    });

    // Only one `<AccountClientStoreContextProvider>` should be mounted at a time
    // on the client. Error if another component is mounted.
    useEffect(() => {
        assert(accountClientStoreForClient);

        assert(!accountClientStoreForClient.isMounted);
        accountClientStoreForClient.isMounted = true;

        return () => {
            assert(accountClientStoreForClient);
            accountClientStoreForClient.isMounted = false;
        };
    }, []);

    return (
        <AccountClientStoreContext.Provider value={store}>
            {children}
        </AccountClientStoreContext.Provider>
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
    const store = useContext(AccountClientStoreContext);

    if (store === null) {
        // In tests, don't require a parent context component. Initialize the global
        // store and return that.
        if (import.meta.jest) {
            return getAccountClientStoreForClient();
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<AccountClientStoreContextProvider>`",
        );
    }

    return store;
}

/**
 * Returns up-to-date data for the provided account that's the same as
 * everywhere else the account is presented. If we observe the account's data
 * change this hook will re-render with the new data.
 */
export function useAccountModel(account: AccountModel): AccountModelData {
    const store = useAccountClientStore();
    const accountDataStore = store.getAccountStore(account);
    return useStore(accountDataStore);
}
