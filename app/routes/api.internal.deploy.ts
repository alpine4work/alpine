import {getDeploy} from "~/server/deploy/data/deploy_actions.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";

export async function loader({request, context, span}: LoaderArgs) {
    try {
        if (request.method !== "GET") throw new InvalidArgumentError("Must use GET HTTP method");

        const deploy = await getDeploy(context);

        return new Response(
            JSON.stringify({
                ok: true,
                activeCommitSha: deploy.activeCommitSha,
                ongoingDeployment: deploy.ongoingDeployment
                    ? {
                          commitSha: deploy.ongoingDeployment.commitSha,
                          workflowRunId: deploy.ongoingDeployment.workflowRunId,
                      }
                    : deploy.dispatchedDeployment
                    ? {
                          commitSha: deploy.dispatchedDeployment.commitSha,
                          workflowRunId: deploy.dispatchedDeployment.workflowRunId,
                      }
                    : null,
                scheduledDeployment: deploy.scheduledDeployment
                    ? {
                          commitSha: deploy.scheduledDeployment.commitSha,
                          nextDeployableTime: deploy.scheduledDeployment.nextDeployableTime
                              ? serializeDateString(deploy.scheduledDeployment.nextDeployableTime)
                              : null,
                      }
                    : null,
            }),
            {
                status: 200,
                headers: {"content-type": "application/json"},
            },
        );
    } catch (error) {
        span.addException(error);

        return new Response(
            JSON.stringify({
                ok: false,
                error: ErrorSchema.serialize(error),
            }),
            {
                status: isSystemError(error) ? 500 : 400,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
