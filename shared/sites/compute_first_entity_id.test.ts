import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    SiteId,
    SiteSideBarId,
    SiteSideBarSectionId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {computeFirstEntityId} from "~/shared/sites/compute_first_entity_id.js";
import {
    SiteContainerId,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntityModel,
    SiteEntryModel,
    SiteEntrySearchEntityModel,
    SitePreviewModelData,
    SiteSideBarModel,
    SiteSideBarSectionModel,
} from "~/shared/sites/site_model.js";
import {SiteTreeBase} from "~/shared/sites/site_tree_base.js";

const siteId = generateId<SiteId>();
const spaceId = generateId<SpaceId>();
const creatorId = generateId<AccountId>();

function createEntityItem(parentId: SiteContainerId, orderKey: string): SiteEntityModel {
    const channelId = generateId<ChannelId>();
    const entityId: SiteItemSearchEntityId = `Channel:${channelId}`;
    return new SiteEntityModel({
        type: "Entity",
        id: entityId,
        orderKey: assertOrderKey(orderKey),
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

function createSideBarItem(): SiteSideBarModel {
    return new SiteSideBarModel({
        type: "SideBar",
        id: `SideBar:${generateId<SiteSideBarId>()}`,
        orderKey: assertOrderKey("a0"),
        label: "SideBar",
        parentId: null,
        version: 0,
    });
}

function createSideBarSectionItem(
    parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId,
    orderKey: string,
): SiteSideBarSectionModel {
    return new SiteSideBarSectionModel({
        type: "SideBarSection",
        id: `SideBarSection:${generateId<SiteSideBarSectionId>()}`,
        orderKey: assertOrderKey(orderKey),
        label: "Section",
        parentId,
        version: 0,
    });
}

function makeTree(...entries: Array<SiteEntryModel>): SiteTreeBase<SiteEntryModel> {
    const rootEntry = entries.find(
        (e): e is SiteSideBarModel => e.type === "SideBar" && e.parentId === null,
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

describe("computeFirstEntityId", () => {
    test("returns null when the root has no children", () => {
        const sideBar = createSideBarItem();

        expect(computeFirstEntityId(sideBar.id, makeTree(sideBar))).toBeNull();
    });

    test("returns the entity id when root has a single entity child", () => {
        const root = createSideBarItem();
        const entity = createEntityItem(root.id, "a0");

        expect(computeFirstEntityId(root.id, makeTree(root, entity))).toBe(entity.id);
    });

    test("returns the entity with the lowest orderKey among multiple entities", () => {
        const root = createSideBarItem();
        const entityC = createEntityItem(root.id, "a2");
        const entityA = createEntityItem(root.id, "a0");
        const entityB = createEntityItem(root.id, "a1");

        // Non-sorted order to verify sorting happens
        const tree = makeTree(root, entityC, entityA, entityB);

        expect(computeFirstEntityId(root.id, tree)).toBe(entityA.id);
    });

    test("finds an entity nested inside a SideBarSection via DFS", () => {
        const root = createSideBarItem();
        const section = createSideBarSectionItem(root.id, "a0");
        const entity = createEntityItem(section.id, "a0");

        expect(computeFirstEntityId(root.id, makeTree(root, section, entity))).toBe(entity.id);
    });

    test("prefers entity in first container by orderKey over entity in second", () => {
        const root = createSideBarItem();
        const sectionFirst = createSideBarSectionItem(root.id, "a0");
        const sectionSecond = createSideBarSectionItem(root.id, "a1");
        const entityInFirst = createEntityItem(sectionFirst.id, "a0");
        const entityInSecond = createEntityItem(sectionSecond.id, "a0");

        // Containers in reverse order to verify sorting
        const tree = makeTree(root, sectionSecond, sectionFirst, entityInFirst, entityInSecond);

        expect(computeFirstEntityId(root.id, tree)).toBe(entityInFirst.id);
    });

    test("excludes a deleted nested entity when called with the post-delete tree", () => {
        // Regression: callers (e.g. `dangerouslyGetRemoveFromSiteTransactionEntries`) pass
        // a tree with the removed entity already deleted. Verify that
        // `computeFirstEntityId` returns the next entity in DFS order — including entities
        // nested inside containers — rather than the deleted one.
        const root = createSideBarItem();
        const section = createSideBarSectionItem(root.id, "a0");
        const deletedEntity = createEntityItem(section.id, "a0");
        const siblingEntity = createEntityItem(section.id, "a1");

        const treeAfterDelete = makeTree(root, section, deletedEntity, siblingEntity).deleteEntry(
            deletedEntity.id,
        );

        expect(computeFirstEntityId(root.id, treeAfterDelete)).toBe(siblingEntity.id);
    });

    test("returns null when the only entity has been deleted from the tree", () => {
        const root = createSideBarItem();
        const entity = createEntityItem(root.id, "a0");

        const treeAfterDelete = makeTree(root, entity).deleteEntry(entity.id);

        expect(computeFirstEntityId(root.id, treeAfterDelete)).toBeNull();
    });

    test("finds an entity through deeply nested sections", () => {
        const root = createSideBarItem();
        const outer = createSideBarSectionItem(root.id, "a0");
        const inner = createSideBarSectionItem(outer.id, "a0");
        const entity = createEntityItem(inner.id, "a0");

        expect(computeFirstEntityId(root.id, makeTree(root, outer, inner, entity))).toBe(entity.id);
    });

    test("returns sibling entity when container with lower orderKey is empty", () => {
        const root = createSideBarItem();
        const emptySection = createSideBarSectionItem(root.id, "a0");
        const siblingEntity = createEntityItem(root.id, "a1");

        const tree = makeTree(root, emptySection, siblingEntity);

        expect(computeFirstEntityId(root.id, tree)).toBe(siblingEntity.id);
    });
});
