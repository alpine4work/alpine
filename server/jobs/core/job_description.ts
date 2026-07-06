import {NotificationEventJobDescriptionSchema} from "~/server/notifications/core/notification_event.js";
import {
    IndexSearchEntityDependentsJobDescriptionSchema,
    IndexSearchEntityEmbeddingChunksJobDescriptionSchema,
    IndexSearchEntityJobDescriptionSchema,
} from "~/server/search/core/index_search_entity_job_description.js";
import {ShareNotificationSchema} from "~/shared/access/share_notification.js";
import {ApiBotWebhookEvent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {
    AccountId,
    BotId,
    BotWebhookEventId,
    BrowserId,
    DatabaseGroupId,
    DatabaseTableId,
    FileId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {
    SendWebPushNotificationOptionsSchema,
    WebPushNotificationContentSchema,
} from "~/shared/notifications/web_push_notification_content.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * An object representing a background job. Jobs allow you to perform work without
 * blocking the critical path. For example, you can:
 *
 * - Index search entities
 * - Send push notifications
 * - Perform some billing charge
 *
 * Jobs go to a single [AWS SQS][1] queue and are handled by a single service
 * (`JobQueueService`). Why do we use a single service? It simplifies things. We
 * have one job framework and you don't need to think about the underlying
 * implementation.
 *
 * Job ordering is not guaranteed and jobs are processed with at-least once
 * semantics. As such, job consumer functions must be idempotent. [AWS SQS][1]
 * provides [FIFO queues which guarantee event order][2]. FIFO queues are more
 * expensive and it's harder to achieve high throughput. Generally if you need
 * background processing you should fit the work you need to do to the job
 * framework.
 *
 * Right now, all jobs are processed with the same priority. Eventually, we may
 * build a way to schedule lower priority work in the job framework.
 *
 * Ideally, all jobs should start processing in <10s. In rare occasions (like load
 * spike scenarios) it may take longer to process a job. Don't put work on the job
 * queue if it's important that work happens immediately. Instead you can use
 * `context.process.waitUntil()` to immediately start running some function.
 * However, if a delay is ok and you want to guarantee the work eventually happens
 * (it must survive process restarts) put it on the job queue.
 *
 * [1]: https://aws.amazon.com/sqs
 * [2]:
 *     https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html
 */
export type JobDescription = SchemaType<typeof JobDescriptionSchema>;

// All job descriptions should have a `SpaceId` property.
//
// `NotificationEvent`'s `spaceId` is nested for historical reasons.
assertAssignableTypes<
    JobDescription,
    {spaceId: SpaceId} | {type: "NotificationEvent"; event: {spaceId: SpaceId}}
>();

export function getJobDescriptionSpaceId(job: JobDescription): SpaceId {
    if (job.type === "NotificationEvent") return job.event.spaceId;
    return job.spaceId;
}

/**
 * A job that can only be processed in test environments. To process this job we
 * wait with the `TestCheckpoint` helper.
 */
export type TestJobDescription = SchemaType<typeof TestJobDescriptionSchema>;

const TestJobDescriptionSchema = Schema.object({
    type: Schema.value("Test"),
    spaceId: Schema.id<SpaceId>(),
    checkpointId: Schema.id(),
    shouldThrow: Schema.boolean.optional(),
});

// TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
// original job queue
const ProcessFileJobDescriptionSchema = Schema.object({
    type: Schema.value("ProcessFile"),
    spaceId: Schema.id<SpaceId>(),
    fileId: Schema.id<FileId>(),
    contentType: FileContentTypeSchema,
    reason: Schema.string,
});

const ProcessFileHeavyJobDescriptionSchema = Schema.object({
    type: Schema.value("ProcessFileHeavy"),
    spaceId: Schema.id<SpaceId>(),
    fileId: Schema.id<FileId>(),
    contentType: FileContentTypeSchema,
    reason: Schema.string,
});

const ProcessFileLightJobDescriptionSchema = Schema.object({
    type: Schema.value("ProcessFileLight"),
    spaceId: Schema.id<SpaceId>(),
    fileId: Schema.id<FileId>(),
    contentType: FileContentTypeSchema,
    reason: Schema.string,
});

export type SendShareNotificationJobDescription = SchemaType<
    typeof SendShareNotificationJobDescriptionSchema
>;

const SendShareNotificationJobDescriptionSchema = Schema.object({
    type: Schema.value("SendShareNotification"),
    jobId: Schema.id(),
    spaceId: Schema.id<SpaceId>(),
    actorAccountId: Schema.id<AccountId>(),
    entityId: FileEntityIdSchema,
    notification: ShareNotificationSchema,
});

const AddFeedCandidateEntryJobDescriptionSchema = Schema.object({
    type: Schema.value("AddFeedCandidateEntry"),
    jobId: Schema.id(),
    spaceId: Schema.id<SpaceId>(),
    entry: FeedEntrySchema,
});

const AddFeedAccountCandidateEntryJobDescriptionSchema = Schema.object({
    type: Schema.value("AddFeedAccountCandidateEntry"),
    jobId: Schema.id(),
    spaceId: Schema.id<SpaceId>(),
    accountId: Schema.id<AccountId>(),
    entry: FeedEntrySchema,
});

export type CallBotWebhookJobDescription = SchemaType<typeof CallBotWebhookJobDescriptionSchema>;

export type ProcessFileLightJobDescription = SchemaType<
    typeof ProcessFileLightJobDescriptionSchema
>;

export type ProcessFileHeavyJobDescription = SchemaType<
    typeof ProcessFileHeavyJobDescriptionSchema
>;

export type ProcessFileJobDescription = SchemaType<typeof ProcessFileJobDescriptionSchema>;

const CallBotWebhookJobDescriptionSchema = Schema.object({
    type: Schema.value("CallBotWebhook"),
    spaceId: Schema.id<SpaceId>(),
    botId: Schema.id<BotId>(),
    botAccountId: Schema.id<AccountId>(),
    eventId: Schema.id<BotWebhookEventId>(),
    event: Schema.unknown<ApiBotWebhookEvent>(),
});

export type SendNotificationDigestJobDescription = SchemaType<
    typeof SendNotificationDigestJobDescriptionSchema
>;

const SendNotificationDigestJobDescriptionSchema = Schema.object({
    type: Schema.value("SendNotificationDigest"),
    spaceId: Schema.id<SpaceId>(),
    accountId: Schema.id<AccountId>(),
    sendTime: Schema.date,
});

const SendWebPushNotificationJobDescriptionSchema = Schema.object({
    type: Schema.value("SendWebPushNotification"),
    spaceId: Schema.id<SpaceId>(),
    accountId: Schema.id<AccountId>(),
    browserId: Schema.id<BrowserId>(),
    notificationContent: WebPushNotificationContentSchema,
    options: SendWebPushNotificationOptionsSchema.optional(),
});

export type SendWebPushNotificationJobDescription = SchemaType<
    typeof SendWebPushNotificationJobDescriptionSchema
>;

const SendNotificationToSlackIntegrationJobDescriptionSchema = Schema.object({
    type: Schema.value("SendNotificationToSlackIntegration"),
    spaceId: Schema.id<SpaceId>(),
    accountId: Schema.id<AccountId>(),
    workspaceId: Schema.string,
    entryPath: Schema.string,
    notificationContent: Schema.object({
        title: Schema.string,
        body: Schema.string,
        plainText: Schema.string,
    }),
});

export type SendNotificationToSlackIntegrationJobDescription = SchemaType<
    typeof SendNotificationToSlackIntegrationJobDescriptionSchema
>;

const SendPendingSubtleNotificationsForInboxJobDescriptionSchema = Schema.object({
    type: Schema.value("SendPendingSubtleNotificationsForInbox"),
    accountId: Schema.id<AccountId>(),
    spaceId: Schema.id<SpaceId>(),
    sendTime: Schema.date,
});

export type SendPendingSubtleNotificationsForInboxJobDescription = SchemaType<
    typeof SendPendingSubtleNotificationsForInboxJobDescriptionSchema
>;

export type ReplicateDatabaseTableChangesJobDescription = SchemaType<
    typeof ReplicateDatabaseTableChangesJobDescriptionSchema
>;

const ReplicateDatabaseTableChangesJobDescriptionSchema = Schema.object({
    type: Schema.value("ReplicateDatabaseTableChanges"),
    spaceId: Schema.id<SpaceId>(),
    databaseGroupId: Schema.id<DatabaseGroupId>(),
    tableIds: Schema.set(Schema.id<DatabaseTableId>()),
});

export const JobDescriptionSchema = Schema.union({
    Test: TestJobDescriptionSchema,
    IndexSearchEntity: IndexSearchEntityJobDescriptionSchema,
    IndexSearchEntityDependents: IndexSearchEntityDependentsJobDescriptionSchema,
    IndexSearchEntityEmbeddingChunks: IndexSearchEntityEmbeddingChunksJobDescriptionSchema,
    NotificationEvent: NotificationEventJobDescriptionSchema,
    ProcessFile: ProcessFileJobDescriptionSchema,
    ProcessFileHeavy: ProcessFileHeavyJobDescriptionSchema,
    ProcessFileLight: ProcessFileLightJobDescriptionSchema,
    SendShareNotification: SendShareNotificationJobDescriptionSchema,
    AddFeedCandidateEntry: AddFeedCandidateEntryJobDescriptionSchema,
    AddFeedAccountCandidateEntry: AddFeedAccountCandidateEntryJobDescriptionSchema,
    CallBotWebhook: CallBotWebhookJobDescriptionSchema,
    SendNotificationDigest: SendNotificationDigestJobDescriptionSchema,
    SendWebPushNotification: SendWebPushNotificationJobDescriptionSchema,
    SendPendingSubtleNotificationsForInbox:
        SendPendingSubtleNotificationsForInboxJobDescriptionSchema,
    SendNotificationToSlackIntegration: SendNotificationToSlackIntegrationJobDescriptionSchema,
    ReplicateDatabaseTableChanges: ReplicateDatabaseTableChangesJobDescriptionSchema,
});
