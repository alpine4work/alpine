import type {ServerActionContext} from "~/server/context/server_action_context.js";
import {fetchDatabaseGroupAction} from "~/server/databases/data/fetch_database_action.js";
import {DatabaseTablesTable} from "~/server/databases/data/internal/database_tables_table.js";
import type {
    OpensearchClientDocVersion,
    OpensearchClientDocWithIdAndVersion,
} from "~/server/opensearch/opensearch_client.js";
import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexBooleanType,
    OpensearchIndexIntegerType,
    OpensearchIndexKeywordType,
    OpensearchIndexObjectType,
    OpensearchIndexTextType,
    OpensearchIndexTypeFlattenedKeysType,
    OpensearchIndexTypeStoredFieldsType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import type {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {isId} from "~/shared/id/id.js";
import type {
    DatabaseFieldId,
    DatabaseGroupId,
    DatabaseTableId,
} from "~/shared/id/types/id_types.js";

type DatabaseTableSearchDocId = string;

const DatabaseTableIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        databaseGroupId: new OpensearchIndexKeywordType({
            isFilterable: true,
        }).validate<DatabaseGroupId>(isId),
        tableId: new OpensearchIndexKeywordType({isFilterable: true}).validate<DatabaseTableId>(
            isId,
        ),
        name: new OpensearchIndexTextType({
            analyzer: "standard",
            fields: {
                keyword: new OpensearchIndexKeywordType({isSortable: true}),
            },
        }),
        tableName: new OpensearchIndexKeywordType(),
        isDeleted: new OpensearchIndexBooleanType({isFilterable: true, isSortable: true}),
        lastReplicatedStorageVersion: new OpensearchIndexIntegerType({isSortable: true}),
    },
});

const DatabaseTableIndex = new OpensearchIndex<
    DatabaseGroupId,
    DatabaseTableSearchDocId,
    OpensearchIndexTypeType<typeof DatabaseTableIndexDocType>,
    OpensearchIndexTypeFlattenedKeysType<typeof DatabaseTableIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof DatabaseTableIndexDocType>
>(DatabaseTableIndexDocType, {
    name: "database_tables",
    numberOfShards: 2,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    refreshInterval: "10s",
    sort: [{field: "databaseGroupId"}, {field: "isDeleted"}, {field: "name.keyword"}],
});

const defaultDatabaseTableAccessPolicy: LocalAccessPolicy = {
    type: "Local",
    accountGrantById: emptyMap,
    defaultGrant: null,
    urlGrant: null,
};

export async function replicateDatabaseTableChanges(
    context: ServerActionContext,
    {
        databaseGroupId,
        storageVersion,
        tableIds,
    }: {
        databaseGroupId: DatabaseGroupId;
        storageVersion: number;
        tableIds: ReadonlyArray<DatabaseTableId>;
    },
): Promise<void> {
    const uniqueTableIds = [...new Set(tableIds)];
    await ensureLocalDatabaseTableIndexIfEnabled(context);
    await runAllPromises(
        uniqueTableIds.map(tableId =>
            replicateDatabaseTableChange(context, {databaseGroupId, storageVersion, tableId}),
        ),
    );
}

export async function ensureLocalDatabaseTableIndexIfEnabled(
    context: ServerActionContext,
): Promise<void> {
    if (process.env.NODE_ENV === "production") return;
    await context.opensearch.ensureLocalIndexIfEnabled(DatabaseTableIndex);
}

async function replicateDatabaseTableChange(
    context: ServerActionContext,
    {
        databaseGroupId,
        storageVersion,
        tableId,
    }: {
        databaseGroupId: DatabaseGroupId;
        storageVersion: number;
        tableId: DatabaseTableId;
    },
): Promise<void> {
    const {result} = await fetchDatabaseGroupAction(context, databaseGroupId, {
        name: "getTableMetadata",
        input: {tableId},
    });

    const table = result.table;
    await updateDatabaseTableDynamoItem(context, {
        databaseGroupId,
        storageVersion,
        tableId,
        table,
    });

    await updateDatabaseTableSearchDoc(context, {
        databaseGroupId,
        storageVersion,
        tableId,
        table,
    });
}

async function updateDatabaseTableDynamoItem(
    context: ServerActionContext,
    {
        databaseGroupId,
        storageVersion,
        tableId,
        table,
    }: {
        databaseGroupId: DatabaseGroupId;
        storageVersion: number;
        tableId: DatabaseTableId;
        table: DatabaseTableMetadata | null;
    },
): Promise<void> {
    await DatabaseTablesTable.updateItem(
        context,
        {
            partitionType: "DatabaseGroup",
            sortRangeType: "Table",
            databaseGroupId,
            tableId,
        },
        item => ({
            ...(item ?? {}),
            partitionType: "DatabaseGroup",
            sortRangeType: "Table",
            databaseGroupId,
            tableId,
            name: table?.name ?? null,
            tableName: table?.tableName ?? null,
            nameFieldId: table?.nameFieldId ?? null,
            isDeleted: table === null,
            lastReplicatedStorageVersion: Math.max(
                item?.lastReplicatedStorageVersion ?? 0,
                storageVersion,
            ),
            accessPolicy: item?.accessPolicy ?? defaultDatabaseTableAccessPolicy,
        }),
    );
}

async function updateDatabaseTableSearchDoc(
    context: ServerActionContext,
    {
        databaseGroupId,
        storageVersion,
        tableId,
        table,
    }: {
        databaseGroupId: DatabaseGroupId;
        storageVersion: number;
        tableId: DatabaseTableId;
        table: DatabaseTableMetadata | null;
    },
): Promise<void> {
    if (process.env.NODE_ENV === "test" && context.opensearch.isDisabledForTest()) return;

    const id = getDatabaseTableSearchDocId(databaseGroupId, tableId);
    const existing = await context.opensearch.getDocIfExists(
        DatabaseTableIndex,
        databaseGroupId,
        id,
    );

    const version: OpensearchClientDocVersion | null = existing?.version ?? null;
    const doc: OpensearchClientDocWithIdAndVersion<
        DatabaseTableSearchDocId,
        OpensearchIndexTypeType<typeof DatabaseTableIndexDocType>
    > = {
        id,
        version,
        databaseGroupId,
        tableId,
        name: table?.name ?? "",
        tableName: table?.tableName ?? "",
        isDeleted: table === null,
        lastReplicatedStorageVersion: Math.max(
            existing?.lastReplicatedStorageVersion ?? 0,
            storageVersion,
        ),
    };

    await context.opensearch.indexDocIfVersion(DatabaseTableIndex, databaseGroupId, doc);
}

function getDatabaseTableSearchDocId(
    databaseGroupId: DatabaseGroupId,
    tableId: DatabaseTableId,
): DatabaseTableSearchDocId {
    return `${databaseGroupId}:${tableId}`;
}

type DatabaseTableMetadata = {
    readonly id: DatabaseTableId;
    readonly name: string;
    readonly tableName: string;
    readonly nameFieldId: DatabaseFieldId;
};
