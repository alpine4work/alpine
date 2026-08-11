import {dangerouslyGetDatabaseGroupAccessPolicyReplicasForDurableObject} from "~/server/databases/data/dangerously_get_database_group_access_policy_replicas_for_durable_object.js";
import {createDatabaseTableMetadataForTest} from "~/server/databases/data/database_table_metadata.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {dangerouslyGetSiteAccessPolicyReplicaWithoutAuthorization} from "~/server/sites/data/dangerously_get_site_access_policy_replica_without_authorization.js";
import {updateSiteAccessPolicy} from "~/server/sites/data/update_site_access_policy.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import type {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {
    AccountId,
    DatabaseGroupId,
    DatabaseTableId,
} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({
    sitesInjection: {dangerouslyGetSiteAccessPolicyReplicaWithoutAuthorization},
});

function managerOnlyPolicy(accountId: AccountId): LocalAccessPolicy {
    return {
        type: "Local",
        accountGrantById: new Map([[accountId, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };
}

test("resolves local policies for the group\u2019s tables and skips unknown ids", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const otherDatabaseGroupId = generateId<DatabaseGroupId>();
    const space = await TestSpace.create(context, {databaseGroupId});
    const session = await space.createSession();
    const tableId = generateId<DatabaseTableId>();
    const otherGroupTableId = generateId<DatabaseTableId>();
    const missingTableId = generateId<DatabaseTableId>();
    const accessPolicy = managerOnlyPolicy(session.account.id);
    await createDatabaseTableMetadataForTest(space.systemAction(), {
        databaseGroupId,
        tableId,
        spaceId: space.id,
        name: "Projects",
        accessPolicy,
    });
    await createDatabaseTableMetadataForTest(space.systemAction(), {
        databaseGroupId: otherDatabaseGroupId,
        tableId: otherGroupTableId,
        spaceId: space.id,
        name: "Other",
        accessPolicy,
    });

    const replicaByTableId = await dangerouslyGetDatabaseGroupAccessPolicyReplicasForDurableObject(
        session.action(),
        {
            databaseGroupId,
            tableIds: [tableId, otherGroupTableId, missingTableId],
        },
    );

    // The table outside the group and the missing table are skipped, not errors.
    expect(replicaByTableId).toEqual(
        new Map([
            [
                tableId,
                {
                    accessPolicy,
                    revision: {tableMetadataVersion: 0, sourcePolicyVersion: 0},
                },
            ],
        ]),
    );
});

test("resolves a site policy source without requiring site access", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const space = await TestSpace.create(context, {databaseGroupId});
    const [owner, member] = await space.createSessions(2);
    // A private site the second member can't see. The table inherits from it, and the
    // refresh must still resolve the table's policy when the second member's
    // connection triggers it.
    const site = await TestSite.create(owner, {access: "Private"});
    const tableId = generateId<DatabaseTableId>();
    await createDatabaseTableMetadataForTest(space.systemAction(), {
        databaseGroupId,
        tableId,
        spaceId: space.id,
        name: "Projects",
        accessPolicy: {type: "Site", siteId: site.id},
    });

    const initialReplicaByTableId =
        await dangerouslyGetDatabaseGroupAccessPolicyReplicasForDurableObject(member.action(), {
            databaseGroupId,
            tableIds: [tableId],
        });
    const initialReplica = assertExists(initialReplicaByTableId.get(tableId));

    const updatedSitePolicy: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([
            [owner.account.id, {level: "Manage", generation: 0}],
            [member.account.id, {level: "View"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };
    await updateSiteAccessPolicy(owner.action(), {
        siteId: site.id,
        accessPolicy: updatedSitePolicy,
    });

    const updatedReplicaByTableId =
        await dangerouslyGetDatabaseGroupAccessPolicyReplicasForDurableObject(member.action(), {
            databaseGroupId,
            tableIds: [tableId],
        });
    const updatedReplica = assertExists(updatedReplicaByTableId.get(tableId));

    expect(updatedReplica.accessPolicy).toEqual(updatedSitePolicy);
    // The site update bumps the source version so the durable object's monotonic guard
    // applies the fresher replica.
    expect(updatedReplica.revision.tableMetadataVersion).toBe(
        initialReplica.revision.tableMetadataVersion,
    );
    expect(updatedReplica.revision.sourcePolicyVersion).toBeGreaterThan(
        initialReplica.revision.sourcePolicyVersion,
    );
});

test("requires space access", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    await TestSpace.create(context, {databaseGroupId});
    const otherSpace = await TestSpace.create(context);
    const outsider = await otherSpace.createSession();

    await expect(
        dangerouslyGetDatabaseGroupAccessPolicyReplicasForDurableObject(outsider.action(), {
            databaseGroupId,
            tableIds: [],
        }),
    ).rejects.toThrow("Account doesn\u2019t have access to space");
});
