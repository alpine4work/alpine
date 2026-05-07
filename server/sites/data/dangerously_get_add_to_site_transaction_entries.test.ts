import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {dangerouslyGetAddToSiteTransactionEntries} from "~/server/sites/data/dangerously_get_add_to_site_transaction_entries.js";
import {dangerouslyGetRemoveFromSiteTransactionEntries} from "~/server/sites/data/dangerously_get_remove_from_site_transaction_entries.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {OrderKey, assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, SiteId, SiteSideBarSectionId} from "~/shared/id/types/id_types.js";
import {SiteContainerId, printSiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteItemSearchEntityId} from "~/shared/sites/site_item_search_entity_id.js";

const context = createTestContext();

/**
 * Direct DB write of an `EntityRef`. Used because these tests work with synthetic
 * entity ids that have no backing entity, so `TestSite.addEntity` (which calls the
 * real `addEntityToSite` action and updates the entity's access policy) would
 * fail.
 */
async function createEntityItem(
    space: Awaited<ReturnType<typeof TestSpace.create>>,
    siteId: SiteId,
    {
        entityId,
        parentId,
        orderKey,
    }: {
        entityId: SiteItemSearchEntityId;
        parentId: SiteContainerId;
        orderKey: OrderKey;
    },
): Promise<void> {
    await SitesTable.createItem(space.systemAction(), {
        partitionType: "Site",
        sortRangeType: "Entity",
        siteId,
        id: entityId,
        type: "Entity",
        orderKey,
        parentId,
        spaceId: space.id,
    });
}

function makeEntityId(): SiteItemSearchEntityId {
    return `Channel:${generateId<ChannelId>()}`;
}

describe("dangerouslyGetAddToSiteTransactionEntries", () => {
    test("returns two transaction entries when adding entity to valid parent", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const entityId = makeEntityId();
        const result = await dangerouslyGetAddToSiteTransactionEntries(session.action(), site.id, {
            entityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        });

        expect(result).toHaveLength(2);
    });

    test("updates firstEntityId when added entity becomes the first in DFS order", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        // Existing entity at orderKey a1
        const existingEntityId = makeEntityId();
        await createEntityItem(space, site.id, {
            entityId: existingEntityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a1"),
        });

        // Add a new entity at orderKey a0 — it should become the first entity in DFS
        // order.
        const newEntityId = makeEntityId();
        const entries = await dangerouslyGetAddToSiteTransactionEntries(session.action(), site.id, {
            entityId: newEntityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        });

        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session.action(),
            entries.map(e => e.transactionEntry),
        );

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId: site.id,
        });
        expect(attrs.firstEntityId).toBe(newEntityId);
    });

    test("does not update firstEntityId when added entity is not first in DFS order", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        // Existing entity at orderKey a0, added via the real data layer so the site's
        // firstEntityId is set to point at it.
        const existingEntityId = makeEntityId();
        const firstEntries = await dangerouslyGetAddToSiteTransactionEntries(
            session.action(),
            site.id,
            {
                entityId: existingEntityId,
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a0"),
            },
        );
        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session.action(),
            firstEntries.map(e => e.transactionEntry),
        );

        // Add new entity at orderKey a1 — NOT the first in DFS order
        const newEntityId = makeEntityId();
        const entries = await dangerouslyGetAddToSiteTransactionEntries(session.action(), site.id, {
            entityId: newEntityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a1"),
        });

        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session.action(),
            entries.map(e => e.transactionEntry),
        );

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId: site.id,
        });
        expect(attrs.firstEntityId).toBe(existingEntityId);
    });

    test("throws when parentId doesn’t exist in the site tree", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const bogusParentId = printSiteContainerId({
            type: "SideBarSection",
            id: generateId<SiteSideBarSectionId>(),
        });

        await expect(
            dangerouslyGetAddToSiteTransactionEntries(session.action(), site.id, {
                entityId: makeEntityId(),
                parentId: bogusParentId,
                orderKey: assertOrderKey("a0"),
            }),
        ).rejects.toThrow("Parent item not found");
    });

    test("throws PermissionDeniedError when actor lacks Manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const site = await TestSite.create(session1);

        await expect(
            dangerouslyGetAddToSiteTransactionEntries(session2.action(), site.id, {
                entityId: makeEntityId(),
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a0"),
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("undeletes a previously deleted entity when re-adding with the same id", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const entityId = makeEntityId();

        const createEntries = await dangerouslyGetAddToSiteTransactionEntries(
            session.action(),
            site.id,
            {entityId, parentId: site.initialRootContainerId, orderKey: assertOrderKey("a0")},
        );
        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session.action(),
            createEntries.map(e => e.transactionEntry),
        );

        const removeEntries = await dangerouslyGetRemoveFromSiteTransactionEntries(
            session.action(),
            site.id,
            entityId,
        );
        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session.action(),
            removeEntries.map(e => e.transactionEntry),
        );

        const reAddEntries = await dangerouslyGetAddToSiteTransactionEntries(
            session.action(),
            site.id,
            {entityId, parentId: site.initialRootContainerId, orderKey: assertOrderKey("a5")},
        );
        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session.action(),
            reAddEntries.map(e => e.transactionEntry),
        );

        const revivedItem = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Entity",
            siteId: site.id,
            id: entityId,
        });

        // Create sets version to 1 (because `deleteItem` is enabled for this sort range),
        // delete bumps the gravestone to 2, and undelete bumps past the gravestone to 3. A
        // fresh `createItem` on an unused id would leave it at 1.
        expect(revivedItem).toMatchObject({
            orderKey: "a5",
            parentId: site.initialRootContainerId,
            updateLockVersion: 3,
        });
    });
});
