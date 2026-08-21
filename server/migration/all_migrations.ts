import {runBackfillAccountEmailCreationTimeMigration} from "~/server/accounts/migrations/backfill_account_email_creation_time.js";
import {runBackfillBotOwnerAndCreatorMigration} from "~/server/bots/migrations/run_backfill_bot_owner_and_creator_migration.js";
import {runUpdateKnownBotSettingsMigration} from "~/server/bots/run_update_known_bot_settings_migration.js";
import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    SitesInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {runMigrateFilesToGlobalPartitionMigration} from "~/server/files/data/migrate_files_to_global_id.js";
import {runIndexChannelPosts2Migration} from "~/server/forum/data/run_index_channel_posts2_migration.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    runIndexChatAndChatMessageSearchEntitiesMigration,
    runIndexEverySearchEntityEmbeddingChunksForceMetadataUpdate,
    runIndexEverySearchEntityMigration,
    runIndexPostAndChannelSearchEntitiesMigration,
    runIndexTaskAndTaskCollectionSearchEntitiesMigration,
} from "~/server/migration/migrations/index_every_search_entity_migration.js";
import {runUpdateAllInboxChannelPostsAndDocumentNewCommentThreadsEntries} from "~/server/notifications/data/run_update_all_inbox_channel_posts_and_document_new_comment_threads_entries.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {runFavoriteTaskPersonalSearchEntityMigration} from "~/server/search/data/table/search_entity_actions.js";
import {runIndexEveryTaskActionStep1Of2} from "~/server/tasks/data/migrations/run_index_every_task_action_step1_of_2.js";
import {runIndexEveryTaskActionStep2Of2} from "~/server/tasks/data/migrations/run_index_every_task_action_step2_of_2.js";
import {runIndexTaskInitialAssigneePositionMigration} from "~/server/tasks/data/migrations/run_index_task_initial_assignee_position_migration.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

export const allMigrations: {
    [key: string]: (
        context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            dynamo: DynamoContextModule;
            jobs: JobsContextModule;
            constants: ConstantsContextModule;
            opensearch: OpensearchContextModule;
            chatInjection: ChatInjectionContextModule;
            documentsInjection: DocumentsInjectionContextModule;
            forumInjection: ForumInjectionContextModule;
            sitesInjection: SitesInjectionContextModule;
            tasksInjection: TasksInjectionContextModule;
        }>,
        options: {segmentIndex: number; totalSegmentCount: number},
    ) => Promise<void>;
} = {
    IndexEverySearchEntity: runIndexEverySearchEntityMigration,
    IndexPostAndChannelSearchEntities: runIndexPostAndChannelSearchEntitiesMigration,
    IndexChatAndChatMessageSearchEntities: runIndexChatAndChatMessageSearchEntitiesMigration,
    IndexTaskAndTaskCollectionSearchEntities: runIndexTaskAndTaskCollectionSearchEntitiesMigration,
    IndexTaskInitialAssigneePosition: runIndexTaskInitialAssigneePositionMigration,
    FavoriteTaskPersonalSearchEntity: runFavoriteTaskPersonalSearchEntityMigration,
    IndexEveryTaskActionStep1Of2: runIndexEveryTaskActionStep1Of2,
    IndexEveryTaskActionStep2Of2: runIndexEveryTaskActionStep2Of2,
    IndexEverySearchEntityEmbeddingChunksForceMetadataUpdate:
        runIndexEverySearchEntityEmbeddingChunksForceMetadataUpdate,
    BackfillAccountEmailCreationTime: runBackfillAccountEmailCreationTimeMigration,
    UpdateAllInboxChannelPostsAndDocumentNewCommentThreadsEntries:
        runUpdateAllInboxChannelPostsAndDocumentNewCommentThreadsEntries,
    UpdateKnownBotSettings: runUpdateKnownBotSettingsMigration,
    BackfillBotOwnerAndCreator: runBackfillBotOwnerAndCreatorMigration,
    MigrateFilesToGlobalPartition: runMigrateFilesToGlobalPartitionMigration,
    IndexChannelPosts2: runIndexChannelPosts2Migration,
};
