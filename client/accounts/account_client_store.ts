import {unstable_LowPriority, unstable_scheduleCallback} from "scheduler";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {Store} from "~/client/helpers/store/store.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {AccountModel, AccountModelData} from "~/shared/accounts/account_model.js";
import {AdvancedWeakValuesMap} from "~/shared/helpers/map/advanced_weak_values_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Normalized store of account model data for the client. When we load data
 * from the server it includes `AccountModel` objects. There may be many
 * `AccountModel` objects with different data that represent the same
 * underlying account. This store will provide one, consistent, view of each
 * `AccountId` on the client. It makes sure we don't render the same account in
 * different ways in different parts of the product.
 *
 * Written so that stores are garbage collected when there are no more
 * references to the associated `AccountModel`s in our realm.
 */
export class AccountClientStore {
    private _scheduledAccountUpdates: Set<AccountModel> | null = null;

    // NOTE(calebmer): We broadly discourage usage of `AdvancedWeakValuesMap` since
    // it leads to non-deterministic behavior. We use it here because it's
    // convenient for the pervasive use of `AccountClientStore` across our
    // codebase.
    //
    // You mostly call `getAccountStore()` on this class which doesn't introduce
    // non-deterministic behavior due to JavaScript garbage collector timing.
    // However, advanced use cases can call `weakGetAccountStoreByIdIfExists()`
    // which does observe non-deterministic behavior due to JavaScript garbage
    // collector timing. It's prefixed with "weak" so callers are discouraged from
    // using it unless they know what they're doing.
    //
    // We could use a simple `Map` but that would lead to a memory leak since
    // account data is never garbage collected. Account data is small so arguably a
    // memory leak is acceptable.
    private readonly _accountDataStoreById = new AdvancedWeakValuesMap<
        AccountId,
        ValueStore<AccountModelData>
    >();

    private readonly _accountDataStoreByModel = new WeakMap<
        AccountModel,
        ValueStore<AccountModelData>
    >();

    private _getAccountStoreWithoutUpdating(account: AccountModel): ValueStore<AccountModelData> {
        const accountStore = getOrSetDefaultMapValue(
            this._accountDataStoreById,
            account.id,
            () => new ValueStore(account.initialData),
        );

        // As long as the `AccountModel` lives, hold a reference to
        // `ValueStore<AccountModelData>`. This prevents a bug where we're in a
        // virtualized scroll view and a component rendering an `AccountModel` is
        // scrolled offscreen so it no longer references the store so the store is
        // garbage collected. If the store held newer `AccountModelData` then when you
        // scroll and `AccountModel` is back onscreen it will appear like the account
        // reverted to its original state.
        //
        // `AccountModel` will still be referenced by whatever data is backing the
        // virtualized scroll view. So keep a reference to the store alive while the
        // `AccountModel` is alive.
        this._accountDataStoreByModel.set(account, accountStore);

        return accountStore;
    }

    /**
     * Get the normalized account data store for our `AccountModel`.
     *
     * If our store hasn't seen the account yet then we'll initialize a store with
     * the `AccountModel`'s `initialData`.
     *
     * If our store has seen the account but our `AccountModel`'s `initialData` is
     * newer than what's in the store, we will schedule a render with the account's
     * new data. Updating everywhere the account is visible in the product.
     */
    public getAccountStore(account: AccountModel): Store<AccountModelData> {
        const accountStore = this._getAccountStoreWithoutUpdating(account);

        if (accountStore.getSnapshot().version < account.initialData.version) {
            this._scheduleAccountUpdate(account);
        }

        return accountStore;
    }

    /**
     * Get the normalized account data store for our `AccountModel`.
     *
     * If our store hasn't seen the account yet then we'll initialize a store with
     * the `AccountModel`'s `initialData`.
     *
     * If our store has seen the account but our `AccountModel`'s `initialData` is
     * newer than what's in the store, we will immediately update the store with
     * the account's new data. Updating everywhere the account is visible in the
     * product.
     *
     * You shouldn't call this in a React render method since it performs a side
     * effect. Instead call `getAccountStore()` which schedules an update for
     * later.
     */
    public getAndImmediatelyUpdateStore(account: AccountModel): Store<AccountModelData> {
        const accountStore = this._getAccountStoreWithoutUpdating(account);

        accountStore.set(accountData => {
            if (accountData.version >= account.initialData.version) return accountData;
            return account.initialData;
        });

        return accountStore;
    }

    /**
     * Get the store for the provided `AccountId` if it exists.
     *
     * Even if the client previously saw an `AccountModel` for the `AccountId` we
     * may have garbage collected the `AccountModel` data meaning this function
     * returns null. That's why this is a "weak" get.
     */
    public weakGetAccountStoreByIdIfExists(accountId: AccountId): Store<AccountModelData> | null {
        return this._accountDataStoreById.get(accountId) ?? null;
    }

    private _scheduleAccountUpdate(account: AccountModel) {
        if (this._scheduledAccountUpdates !== null) {
            this._scheduledAccountUpdates.add(account);
        } else {
            this._scheduledAccountUpdates = new Set([account]);

            // Use the React scheduler to schedule a low priority update. If React is
            // processing user actions then we want that to finish before rendering
            // new accounts.
            unstable_scheduleCallback(unstable_LowPriority, () => {
                const scheduledAccountUpdates = this._scheduledAccountUpdates;
                this._scheduledAccountUpdates = null;
                if (scheduledAccountUpdates === null) return;

                batchStoreUpdates(() => {
                    for (const account of scheduledAccountUpdates) {
                        this._accountDataStoreById.get(account.id)?.set(accountData => {
                            if (accountData.version >= account.initialData.version)
                                return accountData;

                            return account.initialData;
                        });
                    }
                });
            });
        }
    }
}
