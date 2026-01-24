import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";

type CronJobBase = {
    readonly name: string;
    readonly job: MaintenanceJobDescription;
};

// Annoyingly the [AWS cron syntax][1] and the [`node-cron` syntax][2] (based
// on [crontab syntax][3], which is the standard) are different. AWS has a
// year field, plus additional wildcard values that are not supported by `node-cron`.
//
// [1]: https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html
// [2]: https://www.npmjs.com/package/node-cron
// [3]: https://www.gnu.org/software/mcron/manual/html_node/Crontab-file.html
export type CronJob = CronJobBase &
    (
        | {
              readonly rate: CronJobRate;
              readonly cron?: never;
          }
        | {
              readonly cron: CronJobCron;
              readonly rate?: never;
          }
    );

export type CronJobRate =
    | {
          readonly type: "Minutes";
          readonly minutes: number;
      }
    | {
          readonly type: "Hours";
          readonly hours: number;
      };

export type CronJobCron = {
    readonly minute?: string;
    readonly hour?: string;
    readonly day?: string;
    readonly month?: string;
    readonly weekDay?: string;
};

/**
 * Cron jobs are maintenance jobs we send to our SQS job queue on a schedule
 * determined by a cron expression. Their execution may be delayed if our SQS
 * job queue consumers are congested.
 */
export const cronJobs: ReadonlyArray<CronJob> = [
    // It's imperative that we process committed task action transactions in a
    // timely manner so our task DynamoDB table and task OpenSearch index don't
    // drift out of sync. If they drift out of sync we run the risk of undefined
    // behavior and worse, permission violations! Particularly if an action that
    // updates an access policy isn't processed.
    //
    // So every 3 minutes look at our unprocessed task action index and retry
    // anything that hasn't been processed. We need to process all action
    // transactions within `TaskRealtimeActionHistory`'s visibility window. Or else
    // `TaskRealtimeService` may save task data in-memory that is incorrect.
    {
        name: "RetryUnprocessedTaskActionTransactions",
        job: {type: "RetryUnprocessedTaskActionTransactions"},
        rate: {type: "Minutes", minutes: 3},
    },

    // Enqueue scheduled notification digests. We want users to receive their notification digest as
    // close to the scheduled time as possible, so this runs at 2 minutes before the hour to allow for
    // processing time.
    {
        name: "EnqueueScheduledNotificationDigests",
        cron: {
            minute: "58",
        },
        job: {type: "EnqueueScheduledNotificationDigests"},
    },

    // Send all pending subtle notifications for all inboxes with unseen subtle entries.
    // This runs at 55 minutes past the hour to allow for processing time so users receive
    // their batched subtle notifications around the top of the hour.
    {
        name: "SendAllPendingSubtleNotifications",
        cron: {
            minute: "55",
        },
        job: {type: "SendAllPendingSubtleNotifications"},
    },
];

const cronJobNames = new Set<string>();

for (const cronJob of cronJobs) {
    assert(isIdentifier(cronJob.name), "Cron job name must be an identifier");
    assert(!cronJobNames.has(cronJob.name), "Cron job name must be unique");
    cronJobNames.add(cronJob.name);
}
