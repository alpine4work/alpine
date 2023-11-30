import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobQueueSystemActionContext} from "~/server/jobs/queue/job_queue_system_action_context.js";
import {processIndexSearchEntityJob} from "~/server/search/data/search_entity_index.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Id} from "~/shared/id/id.js";

export const processTestJobDescriptionTestCheckpoint = new TestCheckpoint<Id>();

/**
 * Processes a single background job.
 */
export async function processJob(
    context: JobQueueSystemActionContext,
    {sendTime, job}: {sendTime: Date; job: JobDescription},
): Promise<void> {
    switch (job.type) {
        case "Test": {
            await processTestJobDescriptionTestCheckpoint.waitForTest(job.checkpointId);
            return;
        }
        case "IndexSearchEntity": {
            await processIndexSearchEntityJob(context, sendTime, job);
            return;
        }
        default:
            throw exhaustive(job);
    }
}
