/* eslint-disable cyberworlds/no-model-initial-data */

import {unstable_LowPriority, unstable_scheduleCallback} from "scheduler";
import {assert} from "~/shared/helpers/control/assert.js";
import {AdvancedWeakValuesMap} from "~/shared/helpers/map/advanced_weak_values_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel, SitePreviewModelData} from "~/shared/sites/site_model.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * Normalized registry of site preview model data for the client. When we load data
 * from the server it includes `SitePreviewModelData` objects. There may be many
 * `SitePreviewModelData` objects with different data that represent the same
 * underlying site. This registry will provide one, consistent, view of each
 * `SiteId` on the client. It makes sure we don't render the same site in different
 * ways in different parts of the product.
 *
 * Written so that site stores are garbage collected when there are no more
 * references to the associated `SitePreviewModelData`s in our realm.
 */
export class SiteRegistry {
    private _scheduledSiteUpdates: Set<SitePreviewModel> | null = null;

    // NOTE(calebmer): We broadly discourage usage of `AdvancedWeakValuesMap` since it
    // leads to non-deterministic behavior. We use it here because it's convenient for
    // the pervasive use of `SiteRegistry` across our codebase.
    //
    // You mostly call `getSiteStore()` on this class which doesn't introduce
    // non-deterministic behavior due to JavaScript garbage collector timing. However,
    // advanced use cases can call `weakGetSiteStoreByIdIfExists()` which does observe
    // non-deterministic behavior due to JavaScript garbage collector timing. It's
    // prefixed with "weak" so callers are discouraged from using it unless they know
    // what they're doing.
    //
    // We could use a simple `Map` but that would lead to a memory leak since site data
    // would never be garbage collected. Site data is small so arguably a memory leak
    // is acceptable.
    private readonly _siteStoreById = new AdvancedWeakValuesMap<
        SiteId,
        ValueStore<SitePreviewModelData>
    >();

    private readonly _siteStoreByModel = new WeakMap<
        SitePreviewModel,
        ValueStore<SitePreviewModelData>
    >();

    private _getSiteStoreWithoutUpdating(site: SitePreviewModel): ValueStore<SitePreviewModelData> {
        const siteStore = getOrSetDefaultMapValue(
            this._siteStoreById,
            site.id,
            () => new ValueStore<SitePreviewModelData>(site.initialData),
        );

        // As long as the `SitePreviewModelData` lives, hold a reference to
        // `ValueStore<SitePreviewModelData>`. This prevents a bug where we're in a
        // virtualized scroll view and a component rendering a `SitePreviewModelData` is
        // scrolled offscreen so it no longer references the store so the store is garbage
        // collected. If the store held newer `SitePreviewModelData` then when you scroll
        // and `SitePreviewModelData` is back onscreen it will appear like the site
        // reverted to its original state.
        //
        // `SitePreviewModelData` will still be referenced by whatever data is backing the
        // virtualized scroll view. So keep a reference to the store alive while the
        // `SitePreviewModelData` is alive.
        this._siteStoreByModel.set(site, siteStore);

        return siteStore;
    }

    /**
     * Get the normalized site data store for our `SitePreviewModelData`.
     *
     * If our store hasn't seen the site yet then we'll initialize a store with the
     * `SitePreviewModelData`.
     *
     * If our store has seen the site but our `SitePreviewModelData` is newer than
     * what's in the store, we will schedule a render with the site's new data.
     * Updating everywhere the site is visible in the product.
     */
    public getSiteStore(site: SitePreviewModel): Store<SitePreviewModelData> {
        const siteStore = this._getSiteStoreWithoutUpdating(site);

        // Don't schedule site update on the server.
        if (typeof window !== "undefined") {
            const siteSnapshot = siteStore.getSnapshot();
            if (siteSnapshot.version < site.initialData.version) {
                this._scheduleSiteUpdate(site);
            }
        }

        return siteStore;
    }

    /**
     * Get the normalized site data store for our `SitePreviewModelData`.
     *
     * If our store hasn't seen the site yet then we'll initialize a store with the
     * `SitePreviewModelData`.
     *
     * If our store has seen the site but our `SitePreviewModelData` is newer than
     * what's in the store, we will immediately update the store with the site's new
     * data. Updating everywhere the site is visible in the product.
     *
     * You shouldn't call this in a React render method since it performs a side
     * effect. Instead call `getSiteStore()` which schedules an update for later.
     */
    public getAndImmediatelyUpdateSiteStore(
        newSite: SitePreviewModel,
    ): Store<SitePreviewModelData> {
        const siteStore = this._getSiteStoreWithoutUpdating(newSite);

        siteStore.set(oldSite => SitePreviewModel.mergeData(oldSite, newSite.initialData));

        return siteStore;
    }

    /**
     * If our store has seen the site but our `SitePreviewModelData` is newer than
     * what's in the store, we will immediately update the store with the site's new
     * data. Updating everywhere the site is visible in the product.
     *
     * You shouldn't call this in a React render method since it performs a side
     * effect. Instead call `getSiteStore()` which schedules an update for later.
     */
    public immediatelyUpdateSiteStoreIfExists(newSite: SitePreviewModel) {
        const siteStore = this._siteStoreById.get(newSite.id);

        siteStore?.set(oldSite => SitePreviewModel.mergeData(oldSite, newSite.initialData));
    }

    /**
     * Get the store for the provided `SiteId` if it exists.
     *
     * Even if the client previously saw a `SitePreviewModelData` for the `SiteId` we
     * may have garbage collected the `SitePreviewModelData` data meaning this function
     * returns null. That's why this is a "weak" get.
     */
    public weakGetSiteStoreByIdIfExists(siteId: SiteId): Store<SitePreviewModelData> | null {
        return this._siteStoreById.get(siteId) ?? null;
    }

    private _scheduleSiteUpdate(site: SitePreviewModel) {
        assert(typeof window !== "undefined");

        if (this._scheduledSiteUpdates !== null) {
            this._scheduledSiteUpdates.add(site);
        } else {
            this._scheduledSiteUpdates = new Set([site]);

            // Use the React scheduler to schedule a low priority update. If React is
            // processing user actions then we want that to finish before rendering new sites.
            unstable_scheduleCallback(unstable_LowPriority, () => {
                this._runScheduledSiteUpdates();
            });
        }
    }

    private _runScheduledSiteUpdates() {
        const scheduledSiteUpdates = this._scheduledSiteUpdates;
        this._scheduledSiteUpdates = null;
        if (scheduledSiteUpdates === null) return;

        batchStoreUpdates(() => {
            for (const newSite of scheduledSiteUpdates) {
                this._siteStoreById
                    .get(newSite.id)
                    ?.set(oldSite => SitePreviewModel.mergeData(oldSite, newSite.initialData));
            }
        });
    }
}
