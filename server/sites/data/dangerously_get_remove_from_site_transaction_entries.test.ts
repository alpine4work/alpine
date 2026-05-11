import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {dangerouslyGetAddToSiteTransactionEntries} from "~/server/sites/data/dangerously_get_add_to_site_transaction_entries.js";
import {dangerouslyGetRemoveFromSiteTransactionEntries} from "~/server/sites/data/dangerously_get_remove_from_site_transaction_entries.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {OrderKey, assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, SiteId} from "~/shared/id/types/id_types.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
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

describe("dangerouslyGetRemoveFromSiteTransactionEntries", () => {
    test("returns two transaction entries for a valid entity removal", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const entityId = makeEntityId();
        const addEntries = await dangerouslyGetAddToSiteTransactionEntries(
            session.action(),
            site.id,
            {entityId, parentId: site.initialRootContainerId, orderKey: assertOrderKey("a0")},
        );
        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session.action(),
            addEntries.map(e => e.transactionEntry),
        );

        const result = await dangerouslyGetRemoveFromSiteTransactionEntries(
            session.action(),
            site.id,
            entityId,
        );

        expect(result).toHaveLength(2);
    });

    test("updates firstEntityId when removed entity was the first", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        const firstEntityId = makeEntityId();
        const secondEntityId = makeEntityId();

        // Add the first entity via the real data layer to set firstEntityId.
        const addFirstEntries = await dangerouslyGetAddToSiteTransactionEntries(
            session.action(),
            site.id,
            {
                entityId: firstEntityId,
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a0"),
            },
        );
        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session.action(),
            addFirstEntries.map(e => e.transactionEntry),
        );

        // Add the second entity directly to bypass the data layer's firstEntityId update —
        // we want firstEntityId to stay pointing at the first entity until the test's
        // remove call is made.
        await createEntityItem(space, site.id, {
            entityId: secondEntityId,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a1"),
        });

        const entries = await dangerouslyGetRemoveFromSiteTransactionEntries(
            session.action(),
            site.id,
            firstEntityId,
        );

        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session.action(),
            entries.map(e => e.transactionEntry),
        );

        const attrs = await SitesTable.getItem(session.action(), {
            partitionType: "Site",
            sortRangeType: "Attributes",
            siteId: site.id,
        });
        expect(attrs.firstEntityId).toBe(secondEntityId);
    });

    test("throws NotFoundError when entity doesn\u2019t exist in the site", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const site = await TestSite.create(session);

        await expect(
            dangerouslyGetRemoveFromSiteTransactionEntries(
                session.action(),
                site.id,
                makeEntityId(),
            ),
        ).rejects.toThrow(NotFoundError);
    });

    test("throws PermissionDeniedError when actor lacks Manage access", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);
        const site = await TestSite.create(session1);

        const entityId = makeEntityId();
        const addEntries = await dangerouslyGetAddToSiteTransactionEntries(
            session1.action(),
            site.id,
            {entityId, parentId: site.initialRootContainerId, orderKey: assertOrderKey("a0")},
        );
        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            session1.action(),
            addEntries.map(e => e.transactionEntry),
        );

        await expect(
            dangerouslyGetRemoveFromSiteTransactionEntries(session2.action(), site.id, entityId),
        ).rejects.toThrow(PermissionDeniedError);
    });
});
