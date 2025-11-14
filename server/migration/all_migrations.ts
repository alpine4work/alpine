import {runBackfillAccountEmailCreationTimeMigration} from "~/server/accounts/migrations/backfill_account_email_creation_time.js";
import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    runIndexEverySearchEntityMigration,
    runIndexPostAndChannelSearchEntitiesMigration,
    runIndexTaskAndTaskCollectionSearchEntitiesMigration,
} from "~/server/migration/migrations/index_every_search_entity_migration.js";
import {runUpdateAllInboxChannelPostsAndDocumentNewCommentThreadsEntries} from "~/server/notifications/data/run_update_all_inbox_channel_posts_and_document_new_comment_threads_entries.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {runFavoriteTaskPersonalSearchEntityMigration} from "~/server/search/data/table/search_entity_actions.js";
import {
    runIndexEveryTaskActionStep1Of2,
    runIndexEveryTaskActionStep2Of2,
    runIndexTaskInitialAssigneePositionMigration,
} from "~/server/tasks/data/task_table.js";
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
            tasksInjection: TasksInjectionContextModule;
        }>,
        options: {segmentIndex: number; totalSegmentCount: number},
    ) => Promise<void>;
} = {
    IndexEverySearchEntity: runIndexEverySearchEntityMigration,
    IndexPostAndChannelSearchEntities: runIndexPostAndChannelSearchEntitiesMigration,
    IndexTaskAndTaskCollectionSearchEntities: runIndexTaskAndTaskCollectionSearchEntitiesMigration,
    IndexTaskInitialAssigneePosition: runIndexTaskInitialAssigneePositionMigration,
    FavoriteTaskPersonalSearchEntity: runFavoriteTaskPersonalSearchEntityMigration,
    IndexEveryTaskActionStep1Of2: runIndexEveryTaskActionStep1Of2,
    IndexEveryTaskActionStep2Of2: runIndexEveryTaskActionStep2Of2,
    BackfillAccountEmailCreationTime: runBackfillAccountEmailCreationTimeMigration,
    UpdateAllInboxChannelPostsAndDocumentNewCommentThreadsEntries:
        runUpdateAllInboxChannelPostsAndDocumentNewCommentThreadsEntries,
};
