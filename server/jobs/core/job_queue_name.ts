import {JobDescription} from "~/server/jobs/core/job_description.js";

export type JobQueueName = (typeof jobQueueNameByType)[keyof typeof jobQueueNameByType];

export const jobQueueNameByType = {
    Test: "Default",
    IndexSearchEntity: "Default",
    IndexSearchEntityDependents: "Default",
    IndexSearchEntityEmbeddingChunks: "Default",
    NotificationEvent: "Default",
    // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
    // original job queue
    ProcessFile: "FileProcessor",
    ProcessFileHeavy: "FileProcessorHeavy",
    ProcessFileLight: "FileProcessorLight",
    SendShareNotification: "Default",
    SendNotificationDigest: "Default",
    SendWebPushNotification: "Default",
    AddFeedCandidateEntry: "Default",
    AddFeedAccountCandidateEntry: "Default",
    CallBotWebhook: "Default",
    SendPendingSubtleNotificationsForInbox: "Default",
    SendNotificationToSlackIntegration: "Default",
    ProcessTaskNotesActivity: "Default",
} as const satisfies Record<JobDescription["type"], string>;

export type JobTypeByQueueName = {
    [QueueName in JobQueueName]: {
        [Type in keyof typeof jobQueueNameByType]: (typeof jobQueueNameByType)[Type] extends QueueName
            ? Type
            : never;
    }[keyof typeof jobQueueNameByType];
};
