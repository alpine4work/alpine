import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {compareByObjectKey} from "~/shared/helpers/sort/compare_by_object_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {computeFirstEntityId} from "~/shared/sites/compute_first_entity_id.js";
import {SiteContainerId, isSiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteContainerEntry, SiteEntityEntry} from "~/shared/sites/site_entry_schema.js";
import {createSiteItemNotFoundError} from "~/shared/sites/site_error_messages.js";
import {SiteItemSearchEntityId} from "~/shared/sites/site_item_search_entity_id.js";
import {SitePreviewModelData} from "~/shared/sites/site_model.js";
import {validateSiteContainerIsEmpty} from "~/shared/sites/validate_site_container_is_empty.js";

export type SiteTreeEntry =
    | (SiteEntityEntry & {id: SiteItemSearchEntityId})
    | (SiteContainerEntry & {id: SiteContainerId});
/**
 * Indexed data structure for efficient site tree operations.
 *
 * - O(1) item lookups by ID via `entryById`
 * - `entriesByParentId` is always sorted by `orderKey` ascending. The invariant is
 *   established by `fromEntries` and preserved by every mutation.
 *
 * Construct via the static `fromEntries` factory, never via `new` directly — the
 * constructor is protected so that the sort invariant cannot be bypassed.
 */
export class SiteTreeBase<Entry extends SiteTreeEntry> {
    readonly site: SitePreviewModelData;

    /**
     * Lookup by compound container ID for containers (e.g. `SideBar:abc123`) and by
     * entity ID for entities (e.g. `Channel:xyz789`). This matches the format used by
     * `parentId` so parent-chain walks can use this map directly.
     */
    readonly entryById: ReadonlyMap<SiteContainerId | SiteItemSearchEntityId, Entry>;
    /** Always sorted by `orderKey` ascending. */
    readonly entriesByParentId: ReadonlyMap<SiteContainerId | null, ReadonlyArray<Entry>>;

    protected constructor(
        site: SitePreviewModelData,
        entryById: ReadonlyMap<SiteContainerId | SiteItemSearchEntityId, Entry>,
        entriesByParentId: ReadonlyMap<SiteContainerId | null, ReadonlyArray<Entry>>,
    ) {
        this.entryById = entryById;
        this.entriesByParentId = entriesByParentId;
        this.site = site;
    }

    static fromEntries<Entry extends SiteTreeEntry>(
        site: SitePreviewModelData,
        entries: ReadonlyArray<Entry>,
    ): SiteTreeBase<Entry> {
        const {entryById, entriesByParentId} = this._buildSortedMaps(entries);
        return new SiteTreeBase(site, entryById, entriesByParentId);
    }

    /**
     * Index a flat entry list into the two maps the constructor expects, with each
     * parent's children sorted ascending by `orderKey`. Subclasses use this to
     * implement their own `fromEntries`-style factories.
     */
    protected static _buildSortedMaps<Entry extends SiteTreeEntry>(
        entries: ReadonlyArray<Entry>,
    ): {
        entryById: Map<SiteContainerId | SiteItemSearchEntityId, Entry>;
        entriesByParentId: Map<SiteContainerId | null, ReadonlyArray<Entry>>;
    } {
        const entryById = new Map<SiteContainerId | SiteItemSearchEntityId, Entry>();
        const entriesByParentId = new Map<SiteContainerId | null, Array<Entry>>();

        for (const entry of entries) {
            entryById.set(entry.id, entry);

            // Ensure containers get into the map even if they are empty.
            if (isSiteContainerId(entry.id)) {
                getOrSetDefaultMapValue(entriesByParentId, entry.id, () => []);
            }

            getOrSetDefaultMapValue(entriesByParentId, entry.parentId, () => []).push(entry);
        }

        for (const children of entriesByParentId.values()) {
            children.sort(compareByObjectKey("orderKey", defaultCompareStrings));
        }

        return {entryById, entriesByParentId};
    }

    public getEntryIfExists(entryKey: SiteContainerId | SiteItemSearchEntityId): Entry | undefined {
        return this.entryById.get(entryKey);
    }

    public getEntry(entryKey: SiteContainerId | SiteItemSearchEntityId): Entry {
        const entry = this.getEntryIfExists(entryKey);
        if (!entry) throw createSiteItemNotFoundError(this.site.id, entryKey);
        return entry;
    }

    /** Returns children sorted by `orderKey` ascending. */
    public getChildrenForParent(parentId: SiteContainerId | null): ReadonlyArray<Entry> {
        const children = this.entriesByParentId.get(parentId);
        if (!children) throw createSiteItemNotFoundError(this.site.id, parentId ?? "Root");
        return children;
    }

    addEntry(entry: Entry): SiteTreeBase<Entry> {
        const newEntryById = new Map(this.entryById);
        const newEntriesByParentId = new Map(this.entriesByParentId);

        newEntryById.set(entry.id, entry);

        const siblings = newEntriesByParentId.get(entry.parentId);
        if (!siblings) {
            throw createSiteItemNotFoundError(this.site.id, entry.parentId ?? "Root");
        }
        const newSiblings = [...siblings, entry];
        newSiblings.sort(compareByObjectKey("orderKey", defaultCompareStrings));
        newEntriesByParentId.set(entry.parentId, newSiblings);

        // Brand-new containers need their own children bucket so future children can be
        // added under them.
        if (isSiteContainerId(entry.id)) {
            newEntriesByParentId.set(entry.id, []);
        }

        const nextTree = new SiteTreeBase(this.site, newEntryById, newEntriesByParentId);
        return nextTree._updateFirstEntityIdIfNeeded();
    }

    updateEntry(
        entryKey: SiteContainerId | SiteItemSearchEntityId,
        update: (entry: Entry) => Entry,
    ): SiteTreeBase<Entry> {
        const newEntryById = new Map(this.entryById);
        const newEntriesByParentId = new Map(this.entriesByParentId);

        const oldEntry = this.getEntry(entryKey);
        const newEntry = update(oldEntry);
        newEntryById.set(entryKey, newEntry);

        if (newEntry.parentId === oldEntry.parentId) {
            const siblings = assertExists(newEntriesByParentId.get(newEntry.parentId));
            const newSiblings = siblings.map(e => (e.id === entryKey ? newEntry : e));
            // Re-sort only when the orderKey actually changed; label/version-only edits don't
            // move the entry within its siblings.
            if (newEntry.orderKey !== oldEntry.orderKey) {
                newSiblings.sort(compareByObjectKey("orderKey", defaultCompareStrings));
            }
            newEntriesByParentId.set(newEntry.parentId, newSiblings);
        }
        // Parent changed: remove from old parent and insert into the new parent.
        else {
            // `filter` preserves the sort invariant on the old parent's siblings.
            const oldSiblings = assertExists(newEntriesByParentId.get(oldEntry.parentId));
            newEntriesByParentId.set(
                oldEntry.parentId,
                oldSiblings.filter(e => e.id !== entryKey),
            );

            const newParentSiblings = assertExists(newEntriesByParentId.get(newEntry.parentId));
            const inserted = [...newParentSiblings, newEntry];
            inserted.sort(compareByObjectKey("orderKey", defaultCompareStrings));
            newEntriesByParentId.set(newEntry.parentId, inserted);
        }

        const nextTree = new SiteTreeBase(this.site, newEntryById, newEntriesByParentId);
        return nextTree._updateFirstEntityIdIfNeeded();
    }

    deleteEntry(entryKey: SiteContainerId | SiteItemSearchEntityId): SiteTreeBase<Entry> {
        const oldEntry = this.getEntry(entryKey);
        const newEntryById = new Map(this.entryById);
        const newEntriesByParentId = new Map(this.entriesByParentId);

        // Containers own their children bucket; clean it up to avoid leaving a stale entry
        // in `entriesByParentId` for a container that no longer exists.
        if (isSiteContainerId(oldEntry.id)) {
            validateSiteContainerIsEmpty(oldEntry.id, this);

            newEntriesByParentId.delete(oldEntry.id);
        }

        newEntryById.delete(entryKey);

        // `filter` preserves the sort invariant.
        const siblings = newEntriesByParentId.get(oldEntry.parentId);
        if (siblings) {
            newEntriesByParentId.set(
                oldEntry.parentId,
                siblings.filter(e => e.id !== entryKey),
            );
        }

        const nextTree = new SiteTreeBase(this.site, newEntryById, newEntriesByParentId);

        if (entryKey !== this.site.firstEntityId) return nextTree;

        return nextTree._updateFirstEntityIdIfNeeded();
    }

    updateSite(
        update: (
            site: Omit<SitePreviewModelData, "version">,
        ) => Omit<SitePreviewModelData, "version">,
    ): SiteTreeBase<Entry> {
        const oldSite = this.site;

        // Incrementing the version ensures that the site will be updated everywhere in the
        // app. There shouldn't be a surface in the app that has a newer version than this
        // tree, since we are susbscribed to updates the Site realtime table and the tree
        // is reconstructed whenever there are updates.
        const newSiteData = {
            ...update(oldSite),
            version: oldSite.version + 1,
        };

        return new SiteTreeBase(newSiteData, this.entryById, this.entriesByParentId);
    }

    /**
     * Recompute the site's first entity id and return a tree with the updated site if
     * it changed. Returns `this` unchanged otherwise.
     */
    private _updateFirstEntityIdIfNeeded(): SiteTreeBase<Entry> {
        const newFirstEntityId = computeFirstEntityId(this.site.rootContainerId, this);
        if (newFirstEntityId === this.site.firstEntityId) return this;
        return this.updateSite(site => ({...site, firstEntityId: newFirstEntityId}));
    }

    copyTreeWithNewSite(site: SitePreviewModelData): SiteTreeBase<Entry> {
        return new SiteTreeBase(site, this.entryById, this.entriesByParentId);
    }

    copyTreeWithNewEntries(entries: ReadonlyArray<Entry>): SiteTreeBase<Entry> {
        const {entryById, entriesByParentId} = SiteTreeBase._buildSortedMaps(entries);

        return new SiteTreeBase(this.site, entryById, entriesByParentId);
    }
}
