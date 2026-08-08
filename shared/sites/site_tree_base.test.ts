import {OrderKey, assertOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ChannelId,
    SiteId,
    SiteSideBarId,
    SiteSideBarSectionId,
    SiteTopBarId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {
    SiteContainerId,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
    SiteTopBarContainerId,
} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntityModel,
    SiteEntryModel,
    SiteEntrySearchEntityModel,
    SitePreviewModelData,
    SiteSideBarModel,
    SiteSideBarSectionModel,
    SiteTopBarModel,
} from "~/shared/sites/site_model.js";
import {SiteTreeBase} from "~/shared/sites/site_tree_base.js";

// =============================================================================
// Test fixtures and factories
// =============================================================================

const siteId = generateId<SiteId>();
const spaceId = generateId<SpaceId>();
const creatorId = generateId<AccountId>();

function makeEntity({
    parentId,
    orderKey,
    channelId = generateId<ChannelId>(),
}: {
    parentId: SiteContainerId;
    orderKey: OrderKey;
    channelId?: ChannelId;
}): SiteEntityModel {
    const id: SiteItemSearchEntityId = `Channel:${channelId}`;
    return new SiteEntityModel({
        type: "Entity",
        id,
        orderKey,
        parentId,
        spaceId,
        version: 0,
        entity: SiteEntrySearchEntityModel.new({
            type: "Channel",
            title: "test entity",
            channel: {
                id: channelId,
                version: 0,
            },
        }),
    });
}

// Build a tree that accepts any SiteEntryModel entry type. Tests rely on the tree
// being typed as `ImmutableSiteTree<SiteEntryModel>` so that `addEntry`,
// `updateEntry`, etc. accept entries of any variant (not just the narrow variant
// that happened to be in the constructor's input array).
function makeTree(...entries: Array<SiteEntryModel>): SiteTreeBase<SiteEntryModel> {
    const rootEntry = entries.find(
        (e): e is SiteTopBarModel | SiteSideBarModel =>
            (e.type === "TopBar" || e.type === "SideBar") && e.parentId === null,
    );
    const site: SitePreviewModelData = {
        id: siteId,
        spaceId,
        name: "Test Site",
        firstEntityId: null,
        createdTime: new Date(),
        accessPolicy: {
            type: "Local",
            accountGrantById: new Map(),
            defaultGrant: null,
            urlGrant: null,
        },
        version: 0,
        rootContainerId: rootEntry?.id ?? `SideBar:${generateId<SiteSideBarId>()}`,
        creatorId,
    };
    return SiteTreeBase.fromEntries(site, entries);
}

function makeSection({
    parentId,
    orderKey,
    sectionId = generateId<SiteSideBarSectionId>(),
    label = "section",
}: {
    parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
    orderKey: OrderKey;
    sectionId?: SiteSideBarSectionId;
    label?: string;
}): SiteSideBarSectionModel {
    return new SiteSideBarSectionModel({
        type: "SideBarSection",
        id: `SideBarSection:${sectionId}`,
        orderKey,
        parentId,
        label,
        version: 0,
    });
}

function makeSidebar({
    parentId = null,
    orderKey,
    sidebarId = generateId<SiteSideBarId>(),
    label = "sidebar",
}: {
    parentId?: SiteTopBarContainerId | null;
    orderKey: OrderKey;
    sidebarId?: SiteSideBarId;
    label?: string;
}): SiteSideBarModel {
    return new SiteSideBarModel({
        type: "SideBar",
        id: `SideBar:${sidebarId}`,
        orderKey,
        parentId,
        label,
        version: 0,
    });
}

function makeTopBar({
    orderKey,
    topBarId = generateId<SiteTopBarId>(),
    label = "topbar",
}: {
    orderKey: OrderKey;
    topBarId?: SiteTopBarId;
    label?: string;
}): SiteTopBarModel {
    return new SiteTopBarModel({
        type: "TopBar",
        id: `TopBar:${topBarId}`,
        orderKey,
        parentId: null,
        label,
        version: 0,
    });
}

// =============================================================================
// fromEntries
// =============================================================================

describe("ImmutableSiteTree.fromEntries", () => {
    test("an empty entries array yields an empty tree", () => {
        const tree = makeTree();

        expect(tree.site.id).toBe(siteId);
        expect(tree.entryById.size).toBe(0);
        expect(tree.entriesByParentId.size).toBe(0);
    });

    test("indexes a single entity in entryById and in its parent\u2019s siblings", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});

        const tree = makeTree(sidebar, entity);

        expect(tree.entryById.get(entity.id)).toBe(entity);
        expect(tree.entriesByParentId.get(sidebarKey)).toEqual([entity]);
    });

    test("uses compound keys for containers and entity ids for entities", () => {
        const sidebarId = generateId<SiteSideBarId>();
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0"), sidebarId});
        const sidebarKey = sidebar.id;
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});

        const tree = makeTree(sidebar, entity);

        // Container keyed by `SideBar:<id>` (compound), not raw id.
        expect(tree.entryById.has(sidebarKey)).toBe(true);
        expect(tree.entryById.has(sidebarId as unknown as SiteContainerId)).toBe(false);
        // Entity keyed by its compound `Channel:<id>`.
        expect(tree.entryById.has(entity.id)).toBe(true);
    });

    test("creates an empty children bucket for a container that has no children", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;

        const tree = makeTree(sidebar);

        expect(tree.entriesByParentId.get(sidebarKey)).toEqual([]);
    });

    test("sorts each parent\u2019s children by orderKey regardless of input order", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const entityC = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a2")});
        const entityA = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const entityB = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a1")});

        // Intentionally pass in non-sorted order.
        const tree = makeTree(sidebar, entityC, entityA, entityB);

        expect(tree.entriesByParentId.get(sidebarKey)!.map(e => e.orderKey)).toEqual([
            "a0",
            "a1",
            "a2",
        ]);
    });

    test("indexes a deeply nested tree (TopBar > SideBar > SideBarSection > Entity)", () => {
        const topBar = makeTopBar({orderKey: assertOrderKey("a0")});
        const topBarKey = topBar.id;
        const sidebar = makeSidebar({parentId: topBarKey, orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const section = makeSection({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const sectionKey = section.id;
        const entity = makeEntity({parentId: sectionKey, orderKey: assertOrderKey("a0")});

        const tree = makeTree(topBar, sidebar, section, entity);

        expect(tree.entryById.size).toBe(4);
        expect(tree.entriesByParentId.get(null)).toEqual([topBar]);
        expect(tree.entriesByParentId.get(topBarKey)).toEqual([sidebar]);
        expect(tree.entriesByParentId.get(sidebarKey)).toEqual([section]);
        expect(tree.entriesByParentId.get(sectionKey)).toEqual([entity]);
    });

    test("preserves the original entry references (no cloning)", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});

        const tree = makeTree(sidebar, entity);

        // Same reference in entryById and in siblings array.
        expect(tree.entryById.get(entity.id)).toBe(entity);
        expect(tree.entriesByParentId.get(sidebarKey)![0]).toBe(entity);
    });
});

// =============================================================================
// addEntry
// =============================================================================

describe("ImmutableSiteTree#addEntry", () => {
    test("adds an entity to its parent\u2019s siblings and indexes it in entryById", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const tree = makeTree(sidebar);

        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const next = tree.addEntry(entity);

        expect(next.entryById.get(entity.id)).toBe(entity);
        expect(next.entriesByParentId.get(sidebarKey)).toEqual([entity]);
    });

    test("inserts at the correct sorted position regardless of orderKey value", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const a = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const c = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a2")});
        const tree = makeTree(sidebar, a, c);

        // Insert b between a and c.
        const b = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a1")});
        const next = tree.addEntry(b);

        expect(next.entriesByParentId.get(sidebarKey)!.map(e => e.orderKey)).toEqual([
            "a0",
            "a1",
            "a2",
        ]);
    });

    test("creates an empty child bucket when adding a container", () => {
        const rootSidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const rootSidebarKey = rootSidebar.id;
        const tree = makeTree(rootSidebar);

        const section = makeSection({parentId: rootSidebarKey, orderKey: assertOrderKey("a0")});
        const sectionKey = section.id;
        const next = tree.addEntry(section);

        expect(next.entriesByParentId.has(sectionKey)).toBe(true);
        expect(next.entriesByParentId.get(sectionKey)).toEqual([]);
    });

    test("does not create a child bucket when adding an entity", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const tree = makeTree(sidebar);

        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const next = tree.addEntry(entity);

        expect(next.entriesByParentId.has(entity.id as unknown as SiteContainerId)).toBe(false);
    });

    test("does not mutate the original tree", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const tree = makeTree(sidebar);
        const originalSiblings = tree.entriesByParentId.get(sidebarKey);

        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        tree.addEntry(entity);

        // Original arrays untouched.
        expect(tree.entriesByParentId.get(sidebarKey)).toBe(originalSiblings);
        expect(tree.entriesByParentId.get(sidebarKey)).toEqual([]);
        expect(tree.entryById.has(entity.id)).toBe(false);
    });

    test("the same entry reference appears in both entryById and the siblings array", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const tree = makeTree(sidebar);
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});

        const next = tree.addEntry(entity);

        expect(next.entryById.get(entity.id)).toBe(next.entriesByParentId.get(sidebarKey)![0]);
    });

    test("throws when the parent does not exist in the tree", () => {
        const tree = makeTree();
        const ghostParent: SiteSideBarContainerId = `SideBar:${generateId<SiteSideBarId>()}`;
        const entity = makeEntity({parentId: ghostParent, orderKey: assertOrderKey("a0")});

        expect(() => tree.addEntry(entity)).toThrow();
    });
});

// =============================================================================
// updateEntry
// =============================================================================

describe("ImmutableSiteTree#updateEntry", () => {
    test("throws when the target entry does not exist", () => {
        const tree = makeTree();
        const ghostId: SiteItemSearchEntityId = `Channel:${generateId<ChannelId>()}`;

        expect(() => tree.updateEntry(ghostId, e => e)).toThrow("Site item not found");
    });

    test("replaces the entry in entryById with the value returned by the update fn", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const tree = makeTree(sidebar);

        const next = tree.updateEntry(sidebarKey, entry => ({...entry, label: "renamed"}));

        expect(next.entryById.get(sidebarKey)).toMatchObject({label: "renamed"});
    });

    test("replaces the entry in its parent\u2019s siblings (same-parent, same-orderKey rename)", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const section = makeSection({
            parentId: sidebarKey,
            orderKey: assertOrderKey("a0"),
            label: "old label",
        });
        const sectionKey = section.id;
        const tree = makeTree(sidebar, section);

        const next = tree.updateEntry(sectionKey, entry => ({...entry, label: "new label"}));

        expect(next.entriesByParentId.get(sidebarKey)![0]).toMatchObject({label: "new label"});
    });

    test("re-sorts siblings when orderKey changes within the same parent", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const a = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const b = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a1")});
        const c = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a2")});
        const tree = makeTree(sidebar, a, b, c);

        // Move `a` past `c` by changing only its orderKey.
        const next = tree.updateEntry(a.id, e => ({...e, orderKey: assertOrderKey("a3")}));

        expect(next.entriesByParentId.get(sidebarKey)!.map(e => e.id)).toEqual([b.id, c.id, a.id]);
    });

    test("does not introduce a duplicate in the siblings on same-parent same-orderKey update", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const tree = makeTree(sidebar, entity);

        const next = tree.updateEntry(entity.id, e => ({...e, version: e.version + 1}));

        expect(next.entriesByParentId.get(sidebarKey)).toHaveLength(1);
    });

    test("removes the entry from old parent and inserts into new parent on cross-parent update", () => {
        const oldSidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const oldSidebarKey = oldSidebar.id;
        const newSidebar = makeSidebar({orderKey: assertOrderKey("a1")});
        const newSidebarKey = newSidebar.id;
        const entity = makeEntity({parentId: oldSidebarKey, orderKey: assertOrderKey("a0")});
        const tree = makeTree(oldSidebar, newSidebar, entity);

        const next = tree.updateEntry(
            entity.id,
            e => ({...e, parentId: newSidebarKey}) as SiteEntryModel,
        );

        expect(next.entriesByParentId.get(oldSidebarKey)).toEqual([]);
        expect(next.entriesByParentId.get(newSidebarKey)).toHaveLength(1);
        expect(next.entriesByParentId.get(newSidebarKey)?.[0]?.id).toBe(entity.id);
    });

    test("inserts the moved entry at the correct sorted position in the new parent", () => {
        const oldSidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const oldSidebarKey = oldSidebar.id;
        const newSidebar = makeSidebar({orderKey: assertOrderKey("a1")});
        const newSidebarKey = newSidebar.id;
        const moving = makeEntity({parentId: oldSidebarKey, orderKey: assertOrderKey("a0")});
        const existingA = makeEntity({parentId: newSidebarKey, orderKey: assertOrderKey("a0")});
        const existingC = makeEntity({parentId: newSidebarKey, orderKey: assertOrderKey("a2")});
        const tree = makeTree(oldSidebar, newSidebar, moving, existingA, existingC);

        const next = tree.updateEntry(
            moving.id,
            e =>
                ({
                    ...e,
                    parentId: newSidebarKey,
                    orderKey: assertOrderKey("a1"),
                }) as SiteEntryModel,
        );

        expect(next.entriesByParentId.get(newSidebarKey)!.map(e => e.id)).toEqual([
            existingA.id,
            moving.id,
            existingC.id,
        ]);
    });

    test("works for container-typed entries (uses compound key correctly)", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const sectionA = makeSection({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const sectionB = makeSection({parentId: sidebarKey, orderKey: assertOrderKey("a1")});
        const sectionAKey = sectionA.id;
        const sectionBKey = sectionB.id;
        const tree = makeTree(sidebar, sectionA, sectionB);

        const next = tree.updateEntry(sectionAKey, e => ({...e, label: "renamed A"}));

        expect(next.entryById.get(sectionAKey)).toMatchObject({label: "renamed A"});
        // Critically: sibling list still has only two entries (no duplicate, no missing).
        const keys = next.entriesByParentId.get(sidebarKey)!.map(e => e.id);
        expect(keys).toEqual([sectionAKey, sectionBKey]);
    });

    test("does not mutate the original tree", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const tree = makeTree(sidebar, entity);
        const originalSiblings = tree.entriesByParentId.get(sidebarKey);
        const originalEntry = tree.entryById.get(entity.id);

        tree.updateEntry(entity.id, e => ({...e, version: 99}));

        expect(tree.entryById.get(entity.id)).toBe(originalEntry);
        expect(tree.entriesByParentId.get(sidebarKey)).toBe(originalSiblings);
        expect(tree.entryById.get(entity.id)).toMatchObject({version: 0});
    });

    test("the new entry reference is shared between entryById and the siblings array", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const tree = makeTree(sidebar, entity);

        const next = tree.updateEntry(entity.id, e => ({...e, version: 1}));

        expect(next.entryById.get(entity.id)).toBe(next.entriesByParentId.get(sidebarKey)![0]);
    });
});

// =============================================================================
// deleteEntry
// =============================================================================

describe("ImmutableSiteTree#deleteEntry", () => {
    test("removes an entity from entryById and from its parent\u2019s siblings", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const a = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const b = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a1")});
        const tree = makeTree(sidebar, a, b);

        const next = tree.deleteEntry(a.id);

        expect(next.entryById.has(a.id)).toBe(false);
        expect(next.entriesByParentId.get(sidebarKey)!.map(e => e.id)).toEqual([b.id]);
    });

    test("removes a container\u2019s child bucket from entriesByParentId after deletion", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const section = makeSection({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const sectionKey = section.id;
        const tree = makeTree(sidebar, section);

        const next = tree.deleteEntry(sectionKey);

        expect(next.entryById.has(sectionKey)).toBe(false);
        expect(next.entriesByParentId.has(sectionKey)).toBe(false);
        // Parent's sibling list also reflects the removal.
        expect(next.entriesByParentId.get(sidebarKey)).toEqual([]);
    });

    test("throws when deleting a container that still has children", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const section = makeSection({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const sectionKey = section.id;
        const child = makeEntity({parentId: sectionKey, orderKey: assertOrderKey("a0")});
        const tree = makeTree(sidebar, section, child);

        expect(() => tree.deleteEntry(sectionKey)).toThrow(
            "Can\u2019t delete a container that has children",
        );
    });

    test("throws when the target entry does not exist", () => {
        const tree = makeTree();
        const ghost: SiteItemSearchEntityId = `Channel:${generateId<ChannelId>()}`;

        expect(() => tree.deleteEntry(ghost)).toThrow("Site item not found");
    });

    test("does not mutate the original tree", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const tree = makeTree(sidebar, entity);
        const originalSiblings = tree.entriesByParentId.get(sidebarKey);

        tree.deleteEntry(entity.id);

        expect(tree.entryById.has(entity.id)).toBe(true);
        expect(tree.entriesByParentId.get(sidebarKey)).toBe(originalSiblings);
        expect(tree.entriesByParentId.get(sidebarKey)).toHaveLength(1);
    });
});

// =============================================================================
// Immutability and referential integrity across chained mutations
// =============================================================================

describe("ImmutableSiteTree referential integrity across chained mutations", () => {
    test("each mutation returns a fresh tree object distinct from the previous one", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const tree = makeTree(sidebar);
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});

        const t1 = tree.addEntry(entity);
        const t2 = t1.updateEntry(entity.id, e => ({...e, version: 1}));
        const t3 = t2.deleteEntry(entity.id);

        expect(t1).not.toBe(tree);
        expect(t2).not.toBe(t1);
        expect(t3).not.toBe(t2);
    });

    test("chained mutations preserve siteId across all derived trees", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const tree = makeTree(sidebar);
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});

        const final = tree.addEntry(entity).updateEntry(entity.id, e => ({...e, version: 9}));

        expect(final.site.id).toBe(siteId);
    });

    test("the same entry reference is consistently shared between entryById and siblings after every mutation", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const otherSidebar = makeSidebar({orderKey: assertOrderKey("a1")});
        const otherSidebarKey = otherSidebar.id;
        const entity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        let tree = makeTree(sidebar, otherSidebar, entity);

        // After addEntry: ref shared.
        const newEntity = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a1")});
        tree = tree.addEntry(newEntity);
        expect(tree.entryById.get(newEntity.id)).toBe(
            tree.entriesByParentId.get(sidebarKey)!.find(e => e.id === newEntity.id),
        );

        // After updateEntry (same parent): ref shared.
        tree = tree.updateEntry(entity.id, e => ({...e, version: 5}));
        expect(tree.entryById.get(entity.id)).toBe(
            tree.entriesByParentId.get(sidebarKey)!.find(e => e.id === entity.id),
        );

        // After cross-parent updateEntry: ref shared in the NEW parent.
        tree = tree.updateEntry(
            entity.id,
            e => ({...e, parentId: otherSidebarKey, orderKey: assertOrderKey("a0")}) as typeof e,
        );
        expect(tree.entryById.get(entity.id)).toBe(
            tree.entriesByParentId.get(otherSidebarKey)!.find(e => e.id === entity.id),
        );
        // And entirely absent from the old parent.
        expect(
            tree.entriesByParentId.get(sidebarKey)!.find(e => e.id === entity.id),
        ).toBeUndefined();
    });

    test("entries unaffected by a mutation keep the SAME reference in the new tree", () => {
        const sidebar = makeSidebar({orderKey: assertOrderKey("a0")});
        const sidebarKey = sidebar.id;
        const a = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a0")});
        const b = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a1")});
        const c = makeEntity({parentId: sidebarKey, orderKey: assertOrderKey("a2")});
        const tree = makeTree(sidebar, a, b, c);

        // Update only `b` — `a` and `c` should keep identity in the new tree.
        const next = tree.updateEntry(b.id, e => ({...e, version: 99}));

        expect(next.entryById.get(a.id)).toBe(a);
        expect(next.entryById.get(c.id)).toBe(c);
    });
});
