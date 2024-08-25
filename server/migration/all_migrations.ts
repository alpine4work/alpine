import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {runMoveForumChannelsAndPostsMigration} from "~/server/forum/data/forum_table.js";
import {
    runIndexEverySearchEntityMigration,
    runIndexTaskAndTaskCollectionSearchEntitiesMigration,
} from "~/server/migration/migrations/index_every_search_entity_migration.js";
import {runMoveInboxAttributesItemMigration} from "~/server/notifications/data/notifications_table.js";

export const allMigrations: {
    [key: string]: (
        context: ServerProcessContext,
        options: {segmentIndex: number; totalSegmentCount: number},
    ) => Promise<void>;
} = {
    IndexEverySearchEntity: runIndexEverySearchEntityMigration,
    IndexTaskAndTaskCollectionSearchEntities: runIndexTaskAndTaskCollectionSearchEntitiesMigration,
    MoveForumChannelsAndPostsMigration: runMoveForumChannelsAndPostsMigration,
    MoveInboxAttributesItem: runMoveInboxAttributesItemMigration,
};
