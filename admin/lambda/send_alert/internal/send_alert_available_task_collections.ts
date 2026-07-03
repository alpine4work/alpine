import type {TaskCollectionId} from "~/shared/id/types/id_types.js";

/**
 * Maps alert task collection names used by webhook sources to Alpine task
 * collection ids.
 */
export const sendAlertAvailableTaskCollections = {
    honeycomb: (process.env.SEND_ALERT_HONEYCOMB_TASK_COLLECTION_ID ||
        "cnw0ck1egftx53xv9b1cvben6r") as TaskCollectionId,
};

/**
 * Task collection names that the send alert Lambda can create tasks in.
 */
export type SendAlertAvailableTaskCollection = keyof typeof sendAlertAvailableTaskCollections;
