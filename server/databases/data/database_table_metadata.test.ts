import {
    createDatabaseTable,
    createDatabaseTableMetadataForTest,
    getDatabaseTableMetadataItem,
    getDatabaseTableMetadataRealtimeEvent,
    updateDatabaseTableAccessPolicy,
    updateDatabaseTableName,
} from "~/server/databases/data/database_table_metadata.js";
import {getDatabaseTableLocation} from "~/server/databases/data/get_database_table_location.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getDatabaseGroupIdForSpace} from "~/server/spaces/get_database_group_id_for_space.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import type {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {DatabaseActionFetchResponseSchema} from "~/shared/databases/database_action_fetch_schema.js";
import {DatabaseActionObjectSchema} from "~/shared/databases/database_actions.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {
    DatabaseGroupId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.open_source.js";

const createdViewId = generateId<DatabaseViewId>();
const failedBackingTableName = "Failed backing table";
let failedCreationTableId: DatabaseTableId | undefined;
const context = createTestContext({
    sendRequestToDurableObject: (_context, request) => {
        const action = DatabaseActionObjectSchema.deserialize(request.body ?? null);
        assert(action.name === "createTable");
        if (action.input.humanName === failedBackingTableName) {
            failedCreationTableId = action.input.tableId;
            return Promise.reject(new InternalError("Failed to create backing table"));
        }
        return Promise.resolve(
            DatabaseActionFetchResponseSchema.serialize({
                result: {
                    name: "createTable",
                    output: {
                        tableId: action.input.tableId,
                        sqlName: "projects",
                        viewId: createdViewId,
                    },
                },
                readPages: new Map(),
            }),
        );
    },
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

test("failed backing table creation does not publish table metadata", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await createDatabaseTable(session.action(), {
        spaceId: space.id,
        name: failedBackingTableName,
    }).catch(() => undefined);
    const tableId = assertExists(failedCreationTableId);

    await expect(
        getDatabaseTableMetadataItem(session.action(), tableId, {
            consistency: "Strong",
        }),
    ).rejects.toThrow(`Database table ${tableId} not found`);
});

test("updating a database table access policy requires Manage access", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const space = await TestSpace.create(context, {databaseGroupId});
    const [owner, editor] = await space.createSessions(2);
    const tableId = generateId<DatabaseTableId>();
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

test("updating a database table name writes the name to DynamoDB", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const space = await TestSpace.create(context, {databaseGroupId});
    const owner = await space.createSession();
    const tableId = generateId<DatabaseTableId>();
    const accessPolicy: LocalAccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[owner.account.id, {level: "Manage", generation: 0}]]),
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

    const result = await updateDatabaseTableName(owner.action(), {
        tableId,
        name: "Sales pipeline",
    });

    expect({
        name: (
            await getDatabaseTableMetadataItem(owner.action(), tableId, {
                consistency: "Strong",
            })
        ).model.name,
        eventName: result.events[0]?.type === "PutItem" ? result.events[0].item.model.name : null,
    }).toEqual({name: "Sales pipeline", eventName: "Sales pipeline"});
});

test("updating a database table name requires Manage access", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const space = await TestSpace.create(context, {databaseGroupId});
    const [owner, editor] = await space.createSessions(2);
    const tableId = generateId<DatabaseTableId>();
    const accessPolicy: LocalAccessPolicy = {
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
        accessPolicy,
    });

    await expect(
        updateDatabaseTableName(editor.action(), {tableId, name: "Sales pipeline"}),
    ).rejects.toThrow(`Account does not have Manage access to database table ${tableId}`);
});

test("database table access policy updates enforce manager generations", async () => {
    const databaseGroupId = generateId<DatabaseGroupId>();
    const space = await TestSpace.create(context, {databaseGroupId});
    const [owner, juniorManager] = await space.createSessions(2);
    const tableId = generateId<DatabaseTableId>();
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
    const tableId = generateId<DatabaseTableId>();
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
