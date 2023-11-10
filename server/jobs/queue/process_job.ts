import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Id} from "~/shared/id/id.js";

export const processTestJobDescriptionTestCheckpoint = new TestCheckpoint<Id>();

/**
 * Processes a single background job.
 */
export async function processJob(
    context: ServerSystemActionContext,
    job: JobDescription,
): Promise<void> {
    switch (job.type) {
        case "Test": {
            await processTestJobDescriptionTestCheckpoint.waitForTest(job.checkpointId);
            return;
        }
        case "IndexSearchEntity": {
            return;
        }
        default:
            throw exhaustive(job);
    }
}
