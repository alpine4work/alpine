import {DatabaseTableIdsIndex} from "~/server/databases/data/internal/database_tables_table.js";
import type {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {assert} from "~/shared/helpers/control/assert.js";

export async function runIndexDatabaseTableIdsMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): Promise<void> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    await DatabaseTableIdsIndex.runMigration(context, {
        segmentIndex,
        totalSegmentCount,
    });
}
