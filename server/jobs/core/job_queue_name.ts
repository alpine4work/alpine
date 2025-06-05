import {JobDescription} from "~/server/jobs/core/job_description.js";

export type JobQueueName = (typeof jobQueueNameByType)[keyof typeof jobQueueNameByType];

export const jobQueueNameByType = {
    Test: "Default",
    IndexSearchEntity: "Default",
    IndexSearchEntityDependents: "Default",
    IndexSearchEntityEmbeddingChunks: "Default",
    NotificationEvent: "Default",
    ProcessFile: "FileProcessor",
    SendShareNotification: "Default",
    AddFeedCandidateEntry: "Default",
    AddFeedAccountCandidateEntry: "Default",
} as const satisfies Record<JobDescription["type"], string>;

export type JobTypeByQueueName = {
    [QueueName in JobQueueName]: {
        [Type in keyof typeof jobQueueNameByType]: (typeof jobQueueNameByType)[Type] extends QueueName
            ? Type
            : never;
    }[keyof typeof jobQueueNameByType];
};
