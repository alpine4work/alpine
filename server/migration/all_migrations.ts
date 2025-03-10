import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {runMoveForumChannelsAndPostsMigration} from "~/server/forum/data/forum_table.js";
import {
    runIndexEverySearchEntityMigration,
    runIndexTaskAndTaskCollectionSearchEntitiesMigration,
} from "~/server/migration/migrations/index_every_search_entity_migration.js";
import {runMoveInboxAttributesItemMigration} from "~/server/notifications/data/notifications_table.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {runIndexTaskInitialAssigneePositionMigration} from "~/server/tasks/data/task_table.js";
import {Context} from "~/shared/context/context.js";

export const allMigrations: {
    [key: string]: (
        context: Context<ServerProcessContextModules & {opensearch: OpensearchContextModule}>,
        options: {segmentIndex: number; totalSegmentCount: number},
    ) => Promise<void>;
} = {
    IndexEverySearchEntity: runIndexEverySearchEntityMigration,
    IndexTaskAndTaskCollectionSearchEntities: runIndexTaskAndTaskCollectionSearchEntitiesMigration,
    MoveForumChannelsAndPostsMigration: runMoveForumChannelsAndPostsMigration,
    MoveInboxAttributesItem: runMoveInboxAttributesItemMigration,
    // NOCOMMIT: Run this migration in production
    IndexTaskInitialAssigneePosition: runIndexTaskInitialAssigneePositionMigration,
};
