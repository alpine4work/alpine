import {
    createDatabaseTable,
    createDatabaseTableMetadataForTest,
    getDatabaseTableMetadataItem,
    getDatabaseTableMetadataRealtimeEvent,
    updateDatabaseTableAccessPolicy,
} from "~/server/databases/data/database_table_metadata.js";
import {getDatabaseTableLocation} from "~/server/databases/data/get_database_table_location.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getDatabaseGroupIdForSpace} from "~/server/spaces/get_database_group_id_for_space.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import type {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {DatabaseActionFetchResponseSchema} from "~/shared/databases/database_action_fetch_schema.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseGroupId, DatabaseTableId, DatabaseViewId} from "~/shared/id/types/id_types.js";

const createdViewId = generateChronologicalId<DatabaseViewId>();
const createdTableId = generateChronologicalId<DatabaseTableId>();
const context = createTestContext({
    sendRequestToDurableObject: () =>
        Promise.resolve(
            DatabaseActionFetchResponseSchema.serialize({
                result: {
                    name: "createTable",
                    output: {
                        tableId: createdTableId,
                        tableName: "projects",
                        viewId: createdViewId,
                    },
                },
                readPages: new Map(),
            }),
        ),
});

test("creating the first database assigns its space a database group ID", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {tableId} = await createDatabaseTable(session.action(), {
        spaceId: space.id,
        name: "Projects",
    });
    const databaseGroupId = await getDatabaseGroupIdForSpace(session.action(), space.id);

    expect(await getDatabaseTableLocation(session.action(), tableId)).toEqual({
        databaseGroupId,
        spaceId: space.id,
    });
});

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

test("database table realtime events cannot cross database groups", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const otherDatabaseGroupId = generateId<DatabaseGroupId>();
    const space = await TestSpace.create(context, {databaseGroupId});
    const session = await space.createSession();
    const tableId = generateChronologicalId<DatabaseTableId>();
    const accessPolicy: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };
    await createDatabaseTableMetadataForTest(space.systemAction(), {
        databaseGroupId,
        tableId,
        spaceId: space.id,
        name: "Projects",
        accessPolicy,
    });
    const item = await getDatabaseTableMetadataItem(session.action(), tableId, {
        consistency: "StrongWithinCache",
    });

    await expect(
        getDatabaseTableMetadataRealtimeEvent(session.action(), otherDatabaseGroupId, [
            {
                type: "PutItem",
                item: {key: item.key, version: item.version},
            },
        ]),
    ).rejects.toThrow(
        "Can\u2019t get realtime event for a table outside the designated database group",
    );
});
