import {
    createDatabaseTableMetadataForTest,
    updateDatabaseTableAccessPolicy,
} from "~/server/databases/data/database_table_metadata.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import type {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseGroupId, DatabaseTableId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

test("updating a database table access policy requires Manage access", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const space = await TestSpace.create(context, {databaseGroupId});
    const [owner, editor] = await space.createSessions(2);
    const tableId = generateChronologicalId<DatabaseTableId>();
    const originalAccessPolicy: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([
            [owner.account.id, {level: "Manage", generation: 0}],
            [editor.account.id, {level: "Edit"}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };
    await createDatabaseTableMetadataForTest(space.systemAction(), {
        databaseGroupId,
        tableId,
        spaceId: space.id,
        name: "Projects",
        accessPolicy: originalAccessPolicy,
    });

    await expect(
        updateDatabaseTableAccessPolicy(editor.action(), {
            spaceId: space.id,
            tableId,
            accessPolicy: {
                ...originalAccessPolicy,
                accountGrantById: new Map([
                    [owner.account.id, {level: "Manage", generation: 0}],
                    [editor.account.id, {level: "Manage", generation: 1}],
                ]),
            },
        }),
    ).rejects.toThrow(`Account does not have Manage access to database table ${tableId}`);
});

test("database table access policy updates enforce manager generations", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const space = await TestSpace.create(context, {databaseGroupId});
    const [owner, juniorManager] = await space.createSessions(2);
    const tableId = generateChronologicalId<DatabaseTableId>();
    const originalAccessPolicy: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([
            [owner.account.id, {level: "Manage", generation: 0}],
            [juniorManager.account.id, {level: "Manage", generation: 1}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };
    await createDatabaseTableMetadataForTest(space.systemAction(), {
        databaseGroupId,
        tableId,
        spaceId: space.id,
        name: "Projects",
        accessPolicy: originalAccessPolicy,
    });

    await expect(
        updateDatabaseTableAccessPolicy(juniorManager.action(), {
            spaceId: space.id,
            tableId,
            accessPolicy: {
                ...originalAccessPolicy,
                accountGrantById: new Map([
                    [juniorManager.account.id, {level: "Manage", generation: 1}],
                ]),
            },
        }),
    ).rejects.toThrow(
        "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
    );
});
