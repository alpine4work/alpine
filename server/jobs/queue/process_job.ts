import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobQueueSystemActionContext} from "~/server/jobs/queue/job_queue_system_action_context.js";
import {processIndexSearchEntityJob} from "~/server/search/data/index/search_entity_index.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Processes a single background job.
 */
export async function processJob(
    context: JobQueueSystemActionContext,
    job: JobDescription,
    jobStartTime: Date,
): Promise<void> {
    switch (job.type) {
        case "Test": {
            // Should only be used in unit tests.
            return;
        }
        case "IndexSearchEntity": {
            await processIndexSearchEntityJob(context, job, jobStartTime);
            return;
        }
        default:
            throw exhaustive(job);
    }
}
