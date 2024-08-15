import {ZonedDateTime, isWeekday, parseAbsolute} from "@internationalized/date";
import {GithubContextModuleBase} from "~/server/deploy/data/github_context_module.js";
import {SchedulerContextModuleBase} from "~/server/deploy/data/scheduler_context_module.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    DeadlineExceededError,
    FailedPreconditionError,
    InternalError,
    NotFoundError,
} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export const githubOwner = "cyberworlds";
export const githubRepo = "cyberworlds";

// You can find the GitHub `workflow_id` with the CLI command
// `gh workflow list`.
export const testGithubWorkflowId = 45008180;
export const deployGithubWorkflowId = 111000643;

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

export type DeployAttributesItem = DynamoTableItemType<typeof DeployTable, "Deploy", "Attributes">;

/**
 * Get the current deploy item. We allow reading the deploy item without any
 * authorization so we can implement the `dev deployed` command which a
 * developer can use to check if their commit has been deployed.
 */
export function getDeploy(context: DynamoContext): Promise<DeployAttributesItem> {
    return DeployTable.getItem(context, {partitionType: "Deploy", sortRangeType: "Attributes"});
}

/**
 * Can we start a deploy at the provided time? True if this is a weekday during
 * business hours.
 *
 * Eventually we'll also check if it's a holiday.
 */
function isTimeDeployable(time: ZonedDateTime): boolean {
    // Is this a weekday according to what the US considers weekdays vs weekends?
    if (!isWeekday(time, "en-US")) return false;

    // Is the time within 9am-3:30pm? A standard workday is 9am-5pm.
    //
    // We deploy continuously during work hours. Starting at 9am. We stop deploying
    // at 3:30pm so the last deploy of the day ends around 4:00pm (assuming deploys
    // take ~30min). That way if the deploy causes an issue, we'll be able to
    // identify it ~4:00pm while there are still people working before 5:00pm.
    const isTimeBusinessHours =
        (9 <= time.hour && time.hour <= 14) || (time.hour === 15 && time.minute <= 30);
    if (!isTimeBusinessHours) return false;

    return true;
}

/**
 * Processes the `ScheduleDeploy` maintenance job.
 *
 * - If there's already a scheduled deploy, we'll run it if we're allowed to
 *   deploy. (It's during work hours and there isn't an ongoing deployment.);
 *   AND
 * - If we're provided a `commitSha` we'll schedule that deploy to run later.
 *   Unless we're allowed to deploy now in which case we'll start a deploy for
 *   `commitSha`.
 */
export async function scheduleDeploy(
    context: Context<
        DynamoContextModules & {
            github: GithubContextModuleBase;
            scheduler: SchedulerContextModuleBase;
        }
    >,
    span: TracerSpan,
    {commitSha: newCommitSha}: {commitSha: string | null},
) {
    // Get the time in our headquarter's time zone. We'll only perform a deploy
    // during business hours. We use this time to determine what business
    // hours are.
    const currentTime = parseAbsolute(new Date().toISOString(), "America/New_York");
    const isCurrentTimeDeployable = isTimeDeployable(currentTime);

    span.addData({
        deploy: {
            zonedTime: currentTime.toString(),
            isTimeDeployable: isCurrentTimeDeployable,
        },
    });

    let shouldRunAgain = true;
    let previousDeployItem: DeployAttributesItem | null = null;

    while (shouldRunAgain) {
        shouldRunAgain = false;

        previousDeployItem = await context.dynamo.retryTransaction(
            async (context): Promise<DeployAttributesItem> => {
                const deployItem =
                    previousDeployItem ??
                    (await DeployTable.getItem(
                        context,
                        {
                            partitionType: "Deploy",
                            sortRangeType: "Attributes",
                        },
                        {consistency: "Strong"},
                    ));
                previousDeployItem = null;

                const resolvedDispatchedDeployment = await resolveDeployItemDispatchedDeployment(
                    context,
                    deployItem.dispatchedDeployment,
                );

                // Are we allowed to dispatch the deploy workflow? True if there is no ongoing
                // deployment and it's a weekday during business hours.
                const canDispatchDeploy: boolean =
                    deployItem.ongoingDeployment === null &&
                    resolvedDispatchedDeployment === null &&
                    isCurrentTimeDeployable;

                // If we can dispatch a deploy but there's already a scheduled deployment then
                // dispatch what we've already scheduled!
                //
                // We set `shouldRunAgain = true` so that we can handle `newCommitSha`. This
                // code path ignores `newCommitSha`. When we retry if `canDispatchDeploy` was
                // true it'll be false for `newCommitSha` since `resolvedDispatchedDeployment`
                // should now be non-null.
                if (canDispatchDeploy && deployItem.scheduledDeployment !== null) {
                    shouldRunAgain = true;

                    const newDeployItem: DeployAttributesItem = {
                        ...deployItem,
                        scheduledDeployment: null,
                        dispatchedDeployment: {
                            workflowRunId: null,
                            commitSha: deployItem.scheduledDeployment.commitSha,
                        },
                    };
                    await DeployTable.directlyUpdateItem(context, newDeployItem);

                    await context.github.request(
                        "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
                        {
                            owner: githubOwner,
                            repo: githubRepo,
                            workflow_id: deployGithubWorkflowId,
                            ref: deployItem.scheduledDeployment.commitSha,
                        },
                    );

                    return newDeployItem;
                }

                // If there's no new commit we only cared about running the scheduled
                // deployment. Which we've already done above. We can return happy now.
                if (newCommitSha === null) return deployItem;

                const [commitTestResult, compareResult] = await runAllPromises([
                    context.github.request(
                        "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
                        {
                            owner: githubOwner,
                            repo: githubRepo,
                            workflow_id: testGithubWorkflowId,
                            status: "success",
                            head_sha: newCommitSha,
                        },
                    ),
                    // Check if the new commit is already handled. We check:
                    //
                    // 1. If the commit is in the scheduled deployment. (The scheduled deployment
                    //    contains all the commits for the ongoing deployment and active
                    //    deployment.)
                    // 2. If the commit is in the ongoing deployment. (The ongoing deployment
                    //    contains all the commits for the active deployment.)
                    // 3. If the commit is in the active deployment.
                    context.github.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
                        owner: githubOwner,
                        repo: githubRepo,
                        basehead: `${newCommitSha}...${
                            deployItem.scheduledDeployment?.commitSha ??
                            deployItem.ongoingDeployment?.commitSha ??
                            deployItem.activeCommitSha
                        }`,
                        per_page: 1,
                    }),
                ]);

                // If the commit is already handled we're good! We don't need to schedule or
                // dispatch a new deploy.
                if (compareResult.data.status !== "behind") return deployItem;

                // We should always have a passing test for commits that reach this point.
                // Since we only queue a `ScheduleDeploy` action after a passing test workflow.
                if (!(commitTestResult.data.total_count > 0)) {
                    throw new FailedPreconditionError(
                        quote`Passing test workflow not found for commit ${newCommitSha}`,
                    );
                }

                if (canDispatchDeploy) {
                    // We can't dispatch a deploy over a scheduled deployment. If
                    // `canDispatchDeploy && deployItem.scheduledDeployment === null` then that
                    // should be handled above.
                    assert(deployItem.scheduledDeployment === null);

                    const newDeployItem: DeployAttributesItem = {
                        ...deployItem,
                        dispatchedDeployment: {
                            workflowRunId: null,
                            commitSha: newCommitSha,
                        },
                    };
                    await DeployTable.directlyUpdateItem(context, newDeployItem);

                    await context.github.request(
                        "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
                        {
                            owner: githubOwner,
                            repo: githubRepo,
                            workflow_id: deployGithubWorkflowId,
                            ref: newCommitSha,
                        },
                    );

                    return newDeployItem;
                } else {
                    let shouldCreateSchedule = false;
                    let nextDeployableTime =
                        deployItem.scheduledDeployment?.nextDeployableTime ?? null;

                    // If we can't dispatch the deploy workflow because it's a weekend or
                    // non-business hours, then schedule an SQS message for the next time we're
                    // able to deploy.
                    if (!isCurrentTimeDeployable) {
                        const currentTimePlusOneHour = currentTime.add({hours: 1});

                        let newNextDeployableZonedTime = new ZonedDateTime(
                            currentTimePlusOneHour.year,
                            currentTimePlusOneHour.month,
                            currentTimePlusOneHour.day,
                            currentTimePlusOneHour.timeZone,
                            currentTimePlusOneHour.offset,
                            currentTimePlusOneHour.hour,
                            // Zero out minutes, seconds, and milliseconds. We're only advancing hours.
                            0,
                            0,
                            0,
                        );

                        // Crude but works. Iteratively add an hour to `nextDeployableTime` until we
                        // find a deployable time. If it's a Friday then this will iterate ~48 times as
                        // we add 48 hours to find the next time.
                        let iterationCount = 0;
                        while (!isTimeDeployable(newNextDeployableZonedTime)) {
                            iterationCount++;
                            newNextDeployableZonedTime = newNextDeployableZonedTime.add({hours: 1});

                            // Defend against `isTimeDeployable()` unconditionally returning false to
                            // prevent our server from looping forever.
                            if (iterationCount > 24 * 30) {
                                throw new DeadlineExceededError(
                                    "Iteration limit exceeded when trying to find next deployable time",
                                );
                            }
                        }

                        const newNextDeployableTime = newNextDeployableZonedTime.toDate();

                        // Create a schedule (after our DynamoDB update so we only create one schedule
                        // in case we need to retry) to run `scheduleDeploy()` again at the next
                        // deployable time.
                        if (
                            nextDeployableTime === null ||
                            nextDeployableTime.getTime() < newNextDeployableTime.getTime()
                        ) {
                            nextDeployableTime = newNextDeployableTime;
                            shouldCreateSchedule = true;
                        }
                    }

                    const newDeployItem: DeployAttributesItem = {
                        ...deployItem,
                        // If the scheduled deployment already exists, this overrides it with a newer
                        // commit. We made sure the commit is newer by checking GitHub's
                        // `/compare` API.
                        scheduledDeployment: {
                            commitSha: newCommitSha,
                            nextDeployableTime,
                        },
                    };
                    await DeployTable.directlyUpdateItem(context, newDeployItem);

                    if (shouldCreateSchedule) {
                        await context.scheduler.dangerouslyCreateOnceMaintenanceJobSchedule(
                            "ScheduleDeployAtDeployableTime",
                            assertExists(nextDeployableTime),
                            {type: "ScheduleDeploy", commitSha: null},
                        );
                    }

                    return newDeployItem;
                }
            },
        );

        // Optimization: If we dispatch a deployment in the above
        // `context.dynamo.retryTransaction()` block then wait for the workflow run
        // corresponding with the dispatch to be created and stash it in
        // `dispatchedDeployment.workflowRunId`.
        if (
            previousDeployItem.dispatchedDeployment !== null &&
            previousDeployItem.dispatchedDeployment.workflowRunId === null
        ) {
            const resolvedDispatchedDeployment = unwrapResult(
                await resolveDeployItemDispatchedDeploymentResult(
                    context,
                    previousDeployItem.dispatchedDeployment,
                ),
            );

            previousDeployItem = await DeployTable.updateItem(
                context,
                previousDeployItem,
                deployItem => {
                    if (
                        deployItem.dispatchedDeployment === null ||
                        deployItem.dispatchedDeployment.commitSha !==
                            previousDeployItem?.dispatchedDeployment?.commitSha ||
                        deployItem.dispatchedDeployment.workflowRunId !== null
                    ) {
                        return deployItem;
                    }

                    return {
                        ...deployItem,
                        dispatchedDeployment: resolvedDispatchedDeployment,
                    };
                },
                {initialItem: previousDeployItem},
            );
        }
    }
}

async function resolveDeployItemDispatchedDeployment(
    context: Context<DynamoContextModules & {github: GithubContextModuleBase}>,
    dispatchedDeployment: DeployAttributesItem["dispatchedDeployment"],
): Promise<DeployAttributesItem["dispatchedDeployment"]> {
    const dispatchedDeploymentResult = await resolveDeployItemDispatchedDeploymentResult(
        context,
        dispatchedDeployment,
    );

    if (dispatchedDeploymentResult.ok) {
        return dispatchedDeploymentResult.value;
    } else if (dispatchedDeploymentResult.error instanceof DeadlineExceededError) {
        // If `retryWithExponentialBackoff()` fails then we assume the workflow failed
        // to dispatch. So it's ok to dispatch another workflow.
        return null;
    } else {
        throw dispatchedDeploymentResult.error;
    }
}

async function resolveDeployItemDispatchedDeploymentResult(
    context: Context<DynamoContextModules & {github: GithubContextModuleBase}>,
    dispatchedDeployment: DeployAttributesItem["dispatchedDeployment"],
): Promise<Result<DeployAttributesItem["dispatchedDeployment"]>> {
    if (dispatchedDeployment === null) return {ok: true, value: null};

    if (dispatchedDeployment.workflowRunId !== null) {
        const workflowRunResult = await context.github.request(
            "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
            {
                owner: githubOwner,
                repo: githubRepo,
                run_id: dispatchedDeployment.workflowRunId,
            },
        );

        // If the workflow has concluded, consider `dispatchedDeployment` to be unset
        // so we can dispatch a new deploy.
        if (workflowRunResult.data.conclusion !== null) return {ok: true, value: null};

        return {ok: true, value: dispatchedDeployment};
    }

    return captureResultPromise(() => {
        // After we execute
        // `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` the
        // workflow run is started asynchronously. Keep retrying until we find a
        // matching deploy run.
        return retryWithExponentialBackoff(async retry => {
            const workflowRunsResult = await context.github.request(
                "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
                {
                    owner: githubOwner,
                    repo: githubRepo,
                    workflow_id: deployGithubWorkflowId,
                    head_sha: dispatchedDeployment.commitSha,
                    per_page: 1,
                },
            );

            const workflowRun = workflowRunsResult.data.workflow_runs[0];

            if (!workflowRun)
                throw retry(new NotFoundError("Couldn't find workflow run for dispatch"));

            // If the workflow has concluded, consider `dispatchedDeployment` to be unset
            // so we can dispatch a new deploy.
            if (workflowRun.conclusion !== null) return null;

            return {workflowRunId: workflowRun.id, commitSha: dispatchedDeployment.commitSha};
        });
    });
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
    context: Context<DynamoContextModules & {github: GithubContextModuleBase}>,
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
    if (deployItem.activeCommitSha === commitSha) {
        throw new FailedPreconditionError(quote`Commit ${commitSha} was already deployed`);
    }

    // Make sure the commit we're deploying is later than the currently
    // deployed commit.
    const compareResult = await context.github.request(
        "GET /repos/{owner}/{repo}/compare/{basehead}",
        {
            owner: githubOwner,
            repo: githubRepo,
            basehead: `${commitSha}...${deployItem.activeCommitSha}`,
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
            // Now that we've successfully dispatched, clear our `dispatchedDeployment`
            // state.
            dispatchedDeployment:
                item.dispatchedDeployment?.workflowRunId === workflowRunId
                    ? null
                    : item.dispatchedDeployment,
        }),
        {initialItem: deployItem},
    );
}

/**
 * After a deploy completes, whether it succeeded or failed, run this function to clean
 * up data in our deploy table we setup with `prepareDeploy()`.
 */
export async function cleanupDeploy(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    {
        commitSha,
        workflowRunId,
        initialItem,
        hasAwsDeployFinished,
    }: {
        commitSha: string;
        workflowRunId: number;
        initialItem: DeployAttributesItem;
        hasAwsDeployFinished: boolean;
    },
) {
    // Should only be run from `DeployService`.
    assert(context.tracer.getRoot().serviceName === "DeployService");

    const newDeployItem = await DeployTable.updateItem(
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
                activeCommitSha: hasAwsDeployFinished ? commitSha : item.activeCommitSha,
                ongoingDeployment: null,
            };
        },
        {initialItem},
    );

    // If there's a scheduled deployment, let's dispatch it now that our current
    // deploy is done!
    if (newDeployItem.scheduledDeployment !== null) {
        await context.jobs.dangerouslySendMaintenance({
            type: "ScheduleDeploy",
            commitSha: null,
        });
    }
}
