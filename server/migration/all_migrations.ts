import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {runMoveForumChannelsAndPostsMigration} from "~/server/forum/data/forum_table.js";
import {
    runIndexEverySearchEntityMigration,
    runIndexPostAndChannelSearchEntitiesMigration,
    runIndexTaskAndTaskCollectionSearchEntitiesMigration,
} from "~/server/migration/migrations/index_every_search_entity_migration.js";
import {runMoveInboxAttributesItemMigration} from "~/server/notifications/data/notifications_table.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {runFavoriteTaskPersonalSearchEntityMigration} from "~/server/search/data/table/search_entity_table.js";
import {
    runIndexEveryTaskActionStep1Of2,
    runIndexEveryTaskActionStep2Of2,
    runIndexTaskInitialAssigneePositionMigration,
} from "~/server/tasks/data/task_table.js";
import {Context} from "~/shared/context/context.js";

export const allMigrations: {
    [key: string]: (
        context: Context<ServerProcessContextModules & {opensearch: OpensearchContextModule}>,
        options: {segmentIndex: number; totalSegmentCount: number},
    ) => Promise<void>;
} = {
    IndexEverySearchEntity: runIndexEverySearchEntityMigration,
    IndexPostAndChannelSearchEntities: runIndexPostAndChannelSearchEntitiesMigration,
    IndexTaskAndTaskCollectionSearchEntities: runIndexTaskAndTaskCollectionSearchEntitiesMigration,
    MoveForumChannelsAndPostsMigration: runMoveForumChannelsAndPostsMigration,
    MoveInboxAttributesItem: runMoveInboxAttributesItemMigration,
    IndexTaskInitialAssigneePosition: runIndexTaskInitialAssigneePositionMigration,
    FavoriteTaskPersonalSearchEntity: runFavoriteTaskPersonalSearchEntityMigration,
    IndexEveryTaskActionStep1Of2: runIndexEveryTaskActionStep1Of2,
    IndexEveryTaskActionStep2Of2: runIndexEveryTaskActionStep2Of2,
};
