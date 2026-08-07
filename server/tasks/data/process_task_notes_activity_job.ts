import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {ProcessTaskNotesActivityJobDescription} from "~/server/jobs/core/job_description.js";
import {applyTaskActivityWindowUpdate} from "~/server/tasks/data/internal/apply_task_activity_window_update.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * Applies one notes step transaction to the task's notes activity windows. The job
 * payload carries everything the update needs (captured transactionally by
 * `updateTaskNotesContent()`).
 *
 * Task action activity doesn't need a job because action transactions already have
 * a durable post-commit pipeline: `processTaskActionTransaction()` runs
 * at-least-once, backed by the `wasProcessed` retry sweeper. Notes step
 * transactions have no equivalent processing flag or sweeper, so this SQS job
 * provides the retry envelope instead — redeliveries are dropped by the window
 * version-coverage check rather than an idempotency marker.
 */
export async function processTaskNotesActivityJob(
    context: ServerSystemActionContext,
    job: ProcessTaskNotesActivityJobDescription,
): Promise<void> {
    const systemContext = context.actor.authorizeSystem();
    assert(systemContext.actor.getSpaceId() === job.spaceId, "Task notes job space mismatch");

    await applyTaskActivityWindowUpdate(systemContext, {
        spaceId: job.spaceId,
        taskId: job.taskId,
        update: {
            actor: job.actor,
            activityTime: job.createdTime,
            fromVersion: job.startVersion,
            toVersion: job.endVersion,
            content: {
                type: "Notes",
                beforeContentHash: job.beforeContentHash,
                afterContentHash: job.afterContentHash,
            },
        },
    });
}
