import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {runMoveForumChannelsAndPostsMigration} from "~/server/forum/data/forum_table.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    runIndexEverySearchEntityMigration,
    runIndexTaskAndTaskCollectionSearchEntitiesMigration,
} from "~/server/migration/migrations/index_every_search_entity_migration.js";
import {Context} from "~/shared/context/context.js";

export const allMigrations: {
    [key: string]: (
        context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
        options: {segmentIndex: number; totalSegmentCount: number},
    ) => Promise<void>;
} = {
    IndexEverySearchEntity: runIndexEverySearchEntityMigration,
    IndexTaskAndTaskCollectionSearchEntities: runIndexTaskAndTaskCollectionSearchEntitiesMigration,
    MoveForumChannelsAndPostsMigration: runMoveForumChannelsAndPostsMigration,
};
