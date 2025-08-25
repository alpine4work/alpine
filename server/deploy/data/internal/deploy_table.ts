import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const DeployTable = DynamoTableSchema.new({
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
                        activeCommitSha: Schema.string.originalPropertyKey("commitSha"),

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

                        /**
                         * There's a period of time (up to 5 minutes) between when we've dispatched a
                         * GitHub workflow run (with
                         * "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches") and
                         * when `DeployService` starts processing the deploy. `ongoingDeployment` is
                         * only set while `DeployService` is processing the deploy. So to prevent
                         * dispatching multiple deploys, we set this object before we dispatch with the
                         * GitHub API then `DeployService` sets this to null at the same time it sets
                         * `ongoingDeployment`.
                         *
                         * There are many errors that could happen between deploy GitHub workflow
                         * dispatch and `DeployService` processing a deploy. For example:
                         *
                         * - We could fail in the "Build artifacts" step of
                         *   `.github/workflows/deploy.yaml` before `DeployService` runs. This means
                         *   we'd never set `ongoingDeployment` and clear `dispatchedDeployment`.
                         *
                         * - `dispatchedDeployment` will have `workflowRunId: null` while we're waiting
                         *   on GitHub to spawn a workflow run. The dispatch GitHub API is asynchronous
                         *   and doesn't return a `workflowRunId` to us. So you may need to wait a
                         *   couple seconds before `workflowRunId` is available. Maybe there are cases
                         *   where GitHub never spawns the workflow run?
                         *
                         * To manage these errors, before you use `dispatchedDeployment` you should
                         * call `resolveDeployItemDispatchedDeployment()`. This function waits for the
                         * workflow run to be available and returns null if the deploy workflow
                         * already completed.
                         *
                         * Generally speaking if `dispatchedDeployment` is set then `ongoingDeployment`
                         * should NOT be set and if `ongoingDeployment` is set then
                         * `dispatchedDeployment` should NOT be set. If `dispatchedDeployment` is set
                         * that means you should expect an `ongoingDeployment` for this commit
                         * very soon.
                         */
                        dispatchedDeployment: Schema.object({
                            /**
                             * The [GitHub workflow run][1] that's current deploying our code. Could be
                             * null since dispatching a workflow is asynchronous. So null right after
                             * dispatch then hopefully updated a few seconds after.
                             *
                             * [1]: https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28#get-a-workflow-run
                             */
                            workflowRunId: Schema.integer.nullable(),

                            /**
                             * The git commit SHA we dispatched the GitHub deploy workflow for.
                             */
                            commitSha: Schema.string,

                            /**
                             * When `workflowRunId` is null the way we have to discover the correct
                             * `workflowRunId` is ridiculous. Frustratingly [GitHub doesn't return the
                             * `workflowRunId` from the `/dispatches` API call][1]. And we can't look for
                             * workflow runs with a matching `head_sha === dispatchedDeployment.commitSha`
                             * because we start all workflow runs off the `main` branch since annoyingly
                             * [GitHub ALSO doesn't support dispatching a workflow with an arbitrary commit
                             * sha][2].
                             *
                             * The most reliable approach we've found for finding the `workflowRunId` after
                             * the `/dispatches` API call is implemented by
                             * [`trigger-workflow-and-wait`][3]. The technique it uses is to record all
                             * `workflowRunId`s in the last 2 minutes then after dispatching compare the
                             * new `workflowRunId`s. Any `workflowRunId`s in the new set that weren't in
                             * the old set are considered to be a result of the dispatch.
                             *
                             * I'm (@calebmer) pretty annoyed by GitHub's two limitations here. This
                             * approach will work most of the time but of course there are theoretical race
                             * conditions where we end up with a `workflowRunId` not associated with our
                             * dispatch.
                             *
                             * [1]: https://github.com/orgs/community/discussions/9752
                             * [2]: https://github.com/orgs/community/discussions/75513
                             * [3]: https://github.com/convictional/trigger-workflow-and-wait/tree/master
                             */
                            search: Schema.object({
                                createdTimeRange: Schema.string,
                                oldWorkflowRunIds: Schema.array(Schema.integer),
                            }).default({
                                createdTimeRange: "",
                                oldWorkflowRunIds: [],
                            }),
                        })
                            .nullable()
                            .default(null),

                        /**
                         * The next deploy we'll perform.
                         *
                         * A deploy could be scheduled because:
                         *
                         * - There's an ongoing deploy and we can't run two deploys at once; OR
                         * - We won't run deploys after work hours, so the deploy is scheduled for 9am
                         *   the next work day
                         *
                         * A scheduled deploy may take hours before it becomes the next
                         * `dispatchedDeployment` then `ongoingDeployment`. Since we need to wait for
                         * the current deploy to finish or the next work day.
                         *
                         * The lifecycle of a commit in a successful deploy is:
                         *
                         * 1. Starts in `scheduledDeployment.commitSha` if we can't run the deploy yet
                         * 2. Once we dispatch the deploy GitHub workflow the commit moves to
                         *    `dispatchedDeployment.commitSha`
                         * 3. When `DeployService` starts running from the deploy GitHub
                         *    workflow the commit moves to `ongoingDeployment.commitSha`
                         * 4. If the deploy is successful, the commit becomes `activeCommitSha`
                         *
                         * The deployment attributes have the following relationships:
                         *
                         * - All commits in `activeCommitSha` are in `ongoingDeployment.commitSha`
                         * - All commits in `ongoingDeployment.commitSha` are in
                         *   `dispatchedDeployment.commitSha`
                         * - All commits in `dispatchedDeployment.commitSha` are in
                         *   `scheduledDeployment.commitSha`
                         *
                         * This means `scheduledDeployment` represents the absolute latest commit we'll
                         * deploy. New commits may be queued into the scheduled deploy.
                         */
                        scheduledDeployment: Schema.object({
                            /**
                             * The git commit SHA we'll deploy once this scheduled deployment is run.
                             */
                            commitSha: Schema.string,

                            /**
                             * If we scheduled this deploy outside of business hours, this will be the time
                             * within business hours we've scheduled our next deploy to run.
                             */
                            nextDeployableTime: Schema.date.nullable().default(null),
                        })
                            .nullable()
                            .default(null),
                    }),
                },
            ],
        },
    ],
});
