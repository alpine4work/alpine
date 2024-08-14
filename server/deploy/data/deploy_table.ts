import {GithubContextModule} from "~/server/deploy/data/github_context_module.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {Context} from "~/shared/context/context.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Result} from "~/shared/helpers/control/result.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Schema} from "~/shared/schema/schema.js";

export const githubOwner = "cyberworlds";
export const githubRepo = "cyberworlds";

// You can find the GitHub `workflow_id` with the CLI command
// `gh workflow list`.
export const testGithubWorkflowId = 45008180;

const DeployTable = DynamoTableSchema.new({
    name: "Deploy",
    partitions: [
        {
            name: "Deploy",
            partitionKeyAttributes: {},
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The active git commit SHA in production.
                         *
                         * This does not necessarily represent the version of code running at any given
                         * time. During a deploy we may have two versions of our code running at once.
                         * One would be `commitSha` and the other would be
                         * `ongoingDeployment.commitSha`.
                         */
                        commitSha: Schema.string,

                        /**
                         * When we're running our deploy workflow, this object will be set and will
                         * contain information about the active deployment.
                         *
                         * This object should be cleared once a deployment succeeds or fails. However,
                         * if a deployment is cancelled that we might not be able to clear this
                         * property.
                         */
                        ongoingDeployment: Schema.object({
                            /**
                             * The [GitHub workflow run][1] that's current deploying our code.
                             *
                             * [1]: https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28#get-a-workflow-run
                             */
                            workflowRunId: Schema.integer,

                            /**
                             * The git commit SHA we're in the process of deploying.
                             */
                            commitSha: Schema.string,
                        }).nullable(),
                    }),
                },
            ],
        },
    ],
});

export type DeployAttributesItem = DynamoTableItemType<typeof DeployTable, "Deploy", "Attributes">;

/**
 * Get the current deploy item. We allow reading the deploy item without any
 * authorization so we can implement the `dev deployed` command which a
 * developer can use to check if their commit has been deployed.
 */
export function getDeploy(context: DynamoContext): Promise<DeployAttributesItem> {
    return DeployTable.getItem(context, {partitionType: "Deploy", sortRangeType: "Attributes"});
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function attemptStartDeploy(context: DynamoContext) {
    // TODO(calebmer, #deploy): Implement
    //
    // const commitTestResult = await octokit.actions.listWorkflowRuns({
    //     owner: githubOwner,
    //     repo: githubRepo,
    //     workflow_id: testGithubWorkflowId,
    //     status: "success",
    //     head_sha: commitSha,
    // });
    // if (!(commitTestResult.data.total_count > 0))
    //     throw new FailedPreconditionError("Passing test workflow not found for commit");
}

/**
 * Prepare for a deploy from a GitHub workflow. Does the following:
 *
 * - Runs some validations on the commit:
 *   - Makes sure the commit is on the main branch
 *   - Makes sure the commit hasn't already been deployed
 *   - Makes sure there's a successful test run for the commit
 * - Updates an item in DynamoDB letting it know a deploy has started
 */
export async function prepareDeploy(
    context: Context<DynamoContextModules & {github: GithubContextModule}>,
    {commitSha, workflowRunId}: {commitSha: string; workflowRunId: number},
): Promise<DeployAttributesItem> {
    // Should only be run from `DeployService`.
    assert(context.tracer.getRoot().serviceName === "DeployService");

    const mainCompareResult = await context.github.request(
        "GET /repos/{owner}/{repo}/compare/{basehead}",
        {
            owner: githubOwner,
            repo: githubRepo,
            basehead: `${commitSha}...main`,
            per_page: 1,
        },
    );

    if (
        mainCompareResult.data.status !== "identical" &&
        mainCompareResult.data.status !== "behind"
    ) {
        throw new FailedPreconditionError(
            quote`Commit ${commitSha} is not present in "main" branch (compare status: ${mainCompareResult.data.status})`,
        );
    }

    const [deployItem, commitTestResult] = await runAllPromises([
        DeployTable.getItem(
            context,
            {
                partitionType: "Deploy",
                sortRangeType: "Attributes",
            },
            {consistency: "Strong"},
        ),
        context.github.request("GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs", {
            owner: githubOwner,
            repo: githubRepo,
            workflow_id: testGithubWorkflowId,
            status: "success",
            head_sha: commitSha,
        }),
    ]);

    if (!(commitTestResult.data.total_count > 0)) {
        throw new FailedPreconditionError(
            quote`Passing test workflow not found for commit ${commitSha}`,
        );
    }

    // If the database thinks there's an ongoing deployment, we should throw an
    // error because we can only run one deploy at a time! We use GitHub action's
    // [concurrency control][1] to make sure only one deploy runs at a time. Though
    // we still have this check just in case.
    //
    // If we detect that a workflow run has terminated before we can update the
    // database then we ignore the `ongoingDeployment` property and proceed anyway.
    //
    // [1]: https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-concurrency
    if (deployItem.ongoingDeployment) {
        const workflowRunResult = await context.github.request(
            "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
            {
                owner: githubOwner,
                repo: githubRepo,
                run_id: deployItem.ongoingDeployment.workflowRunId,
            },
        );

        if (
            workflowRunResult.data.conclusion !== "cancelled" &&
            workflowRunResult.data.conclusion !== "failure"
        ) {
            throw new FailedPreconditionError(
                quote`Can't deploy while there's an ongoing deploy workflow run (id: ${deployItem.ongoingDeployment.workflowRunId}, status: ${workflowRunResult.status})`,
            );
        }
    }

    // Deploying a commit again will be a noop.
    if (deployItem.commitSha === commitSha) {
        throw new FailedPreconditionError(quote`Commit ${commitSha} was already deployed`);
    }

    // Make sure the commit we're deploying is later than the currently
    // deployed commit.
    const compareResult = await context.github.request(
        "GET /repos/{owner}/{repo}/compare/{basehead}",
        {
            owner: githubOwner,
            repo: githubRepo,
            basehead: `${commitSha}...${deployItem.commitSha}`,
            per_page: 1,
        },
    );

    // We check that `deployItem.commitSha` is behind `commitSha` so that the
    // `files` array is empty and doesn't return all changed file patches.
    if (compareResult.data.status !== "behind") {
        throw new FailedPreconditionError(
            quote`Commit ${commitSha} was already deployed (compare status: ${compareResult.data.status})`,
        );
    }

    return DeployTable.updateItem(
        context,
        {partitionType: "Deploy", sortRangeType: "Attributes"},
        item => ({
            ...item,
            ongoingDeployment: {
                workflowRunId,
                commitSha,
            },
        }),
        {initialItem: deployItem},
    );
}

/**
 * After a deploy completes, whether it succeeded or failed, run this function to clean
 * up data in our deploy table we setup with `prepareDeploy()`.
 */
export async function cleanupDeploy(
    context: DynamoContext,
    {
        commitSha,
        workflowRunId,
        initialItem,
        result,
    }: {
        commitSha: string;
        workflowRunId: number;
        initialItem: DeployAttributesItem;
        result: Result<unknown>;
    },
) {
    // Should only be run from `DeployService`.
    assert(context.tracer.getRoot().serviceName === "DeployService");

    await DeployTable.updateItem(
        context,
        {partitionType: "Deploy", sortRangeType: "Attributes"},
        item => {
            if (item.ongoingDeployment?.workflowRunId !== workflowRunId) {
                throw new InternalError(
                    quote`Unexpected ongoing deploy workflow run in database (expected id: ${workflowRunId}, actual id: ${item.ongoingDeployment?.workflowRunId})`,
                );
            }

            if (item.ongoingDeployment?.commitSha !== commitSha) {
                throw new InternalError(
                    quote`Unexpected ongoing deploy commit in database (expected commit: ${commitSha}, actual commit: ${item.ongoingDeployment?.commitSha})`,
                );
            }

            return {
                ...item,
                // If the deploy was successful update the deployed commit SHA. Otherwise leave
                // the old commit SHA in place since a failed deploy reverts all infrastructure
                // changes.
                commitSha: result.ok ? commitSha : item.commitSha,
                ongoingDeployment: null,
            };
        },
        {initialItem},
    );
}
