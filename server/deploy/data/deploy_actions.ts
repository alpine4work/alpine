import {ZonedDateTime, isWeekday, parseAbsolute} from "@internationalized/date";
import {addMinutes, subMinutes} from "date-fns";
import {GithubContextModuleBase} from "~/server/deploy/data/github_context_module.js";
import {DeployTable} from "~/server/deploy/data/internal/deploy_table.js";
import {SchedulerContextModuleBase} from "~/server/deploy/data/scheduler_context_module.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableItemType} from "~/server/dynamo/core/dynamo_table_schema.js";
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
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * NOTE: this file is currently being split up. We do not anticipate adding more methods here.
 */

export const githubOwner = "cyberworlds";
export const githubRepo = "cyberworlds";

// You can find the GitHub `workflow_id` with the CLI command
// `gh workflow list`.
export const testGithubWorkflowId = 45008180;
export const deployGithubWorkflowId = 111000643;

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
    // TODO(calebmer): Deploy all the time on weekdays if tests pass. It's really
    // annoying for me when we're out of the deploy window since I work long hours.
    // As the team grows set a proper deployable time policy.
    //
    // TODO(calebmer, 2025-01-09): For launch weekend, allow deploying on
    // weekends too!
    if (true) return true;

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
            newCommit: newCommitSha ?? undefined,
            zonedTime: currentTime.toString(),
            isTimeDeployable: isCurrentTimeDeployable,
        },
    });

    const dispatch = (
        context: Context<
            DynamoContextModules & {
                github: GithubContextModuleBase;
                scheduler: SchedulerContextModuleBase;
            }
        >,
        deployItem: DeployAttributesItem,
        commitSha: string,
    ) => {
        return context.tracer.withSpan("Dispatch deploy workflow", async (context, span) => {
            span.addData({
                deploy: {
                    newCommit: commitSha,
                },
            });

            const searchTime = new Date();

            const searchCreatedTimeRange = [subMinutes(searchTime, 2), addMinutes(searchTime, 1)]
                .map(time => time.toISOString())
                .join("..");

            const searchWorkflowRunsResult = await context.github.request(
                "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
                {
                    owner: githubOwner,
                    repo: githubRepo,
                    workflow_id: deployGithubWorkflowId,
                    created: searchCreatedTimeRange,
                    per_page: 100,
                },
            );

            deployItem = {
                ...deployItem,
                scheduledDeployment: null,
                dispatchedDeployment: {
                    workflowRunId: null,
                    commitSha,
                    search: {
                        createdTimeRange: searchCreatedTimeRange,
                        oldWorkflowRunIds: searchWorkflowRunsResult.data.workflow_runs.map(
                            workflowRun => workflowRun.id,
                        ),
                    },
                },
            };
            deployItem = await DeployTable.directlyUpdateItem(context, deployItem);

            await context.github.request(
                "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
                {
                    owner: githubOwner,
                    repo: githubRepo,
                    workflow_id: deployGithubWorkflowId,
                    // Unfortunately we can only dispatch a workflow with a git branch or tag
                    // ([commit sha's don't work][1]). So we dispatch with the `main` branch and
                    // pass the specific commit as an input.
                    //
                    // [1]: https://github.com/orgs/community/discussions/75513
                    ref: "main",
                    inputs: {commitSha},
                },
            );

            // Wait for the workflow run corresponding with the dispatch to be created and
            // stash it in `dispatchedDeployment.workflowRunId`.
            const resolvedDispatchedDeployment = await context.tracer.withSpan(
                "Resolve dispatched deploy workflow",
                async context =>
                    unwrapResult(
                        await resolveDeployItemDispatchedDeploymentResult(
                            context,
                            deployItem.dispatchedDeployment,
                        ),
                    ),
            );

            // `DeployTable.updateItem()` will call `context.dynamo.retryTransaction()`
            // which we want. If a condition check error happens when updating
            // `workflowRunId` we don't want to retry our entire `dispatchOrSchedule()`
            // transaction since the `/dispatches` GitHub API won't be called a
            // second time.
            deployItem = await DeployTable.updateItem(
                context,
                deployItem,
                currentDeployItem => {
                    if (
                        currentDeployItem.dispatchedDeployment === null ||
                        currentDeployItem.dispatchedDeployment.commitSha !==
                            deployItem?.dispatchedDeployment?.commitSha ||
                        currentDeployItem.dispatchedDeployment.workflowRunId !== null
                    ) {
                        return deployItem;
                    }

                    return {
                        ...deployItem,
                        dispatchedDeployment: resolvedDispatchedDeployment,
                    };
                },
                {initialItem: deployItem},
            );

            return deployItem;
        });
    };

    const dispatchOrSchedule = async (
        context: Context<
            DynamoContextModules & {
                github: GithubContextModuleBase;
                scheduler: SchedulerContextModuleBase;
            }
        >,
        initialDeployItem: DeployAttributesItem | null,
    ): Promise<DeployAttributesItem> => {
        const deployItem =
            initialDeployItem ??
            (await DeployTable.getItem(
                context,
                {
                    partitionType: "Deploy",
                    sortRangeType: "Attributes",
                },
                {consistency: "Strong"},
            ));

        // We need to resolve `ongoingDeployment` and `dispatchedDeployment` in error
        // edge cases where GitHub has concluded its workflow run but we didn't get a
        // chance to update DynamoDB.
        const [resolvedOngoingDeployment, resolvedDispatchedDeployment] = await runAllPromises([
            resolveDeployItemOngoingDeployment(context, deployItem.ongoingDeployment),
            resolveDeployItemDispatchedDeployment(context, deployItem.dispatchedDeployment),
        ]);

        // Are we allowed to dispatch the deploy workflow? True if there is no ongoing
        // deployment and it's a weekday during business hours.
        const canDispatchDeploy: boolean =
            resolvedOngoingDeployment === null &&
            resolvedDispatchedDeployment === null &&
            isCurrentTimeDeployable;

        // If there's a scheduled deploy then dispatch that! Then we'll call `run()`
        // again to schedule `newCommitSha`.
        if (canDispatchDeploy && deployItem.scheduledDeployment !== null) {
            const newDeployItem = await dispatch(
                context,
                deployItem,
                deployItem.scheduledDeployment.commitSha,
            );

            return dispatchOrSchedule(context, newDeployItem);
        }

        span.addData({
            deploy: {
                activeCommit: deployItem.activeCommitSha,
                ongoingDeploymentCommit: resolvedOngoingDeployment?.commitSha ?? undefined,
                dispatchedDeploymentCommit: resolvedDispatchedDeployment?.commitSha ?? undefined,
            },
        });

        // If there's no new commit we only cared about running the scheduled
        // deployment. Which we've already done above. We can return happy now.
        if (newCommitSha === null) return deployItem;

        const [compareResult] = await runAllPromises([
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

            // We should always have a passing test for commits that reach this point.
            // Since we only queue a `ScheduleDeploy` action after a passing test workflow.
            //
            // Because we queue this message within `.github/workflows/test.yaml` workflow
            // (before it's actually finished) it might take a second or two for GitHub to
            // update the workflow to a `passed` status. So retry until we find a successful
            // test run.
            retryWithExponentialBackoff(async retry => {
                const commitTestResult = await context.github.request(
                    "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
                    {
                        owner: githubOwner,
                        repo: githubRepo,
                        workflow_id: testGithubWorkflowId,
                        status: "success",
                        head_sha: newCommitSha,
                    },
                );

                if (!(commitTestResult.data.total_count > 0)) {
                    retry(
                        new FailedPreconditionError(
                            quote`Passing test workflow not found for commit ${newCommitSha}`,
                        ),
                    );
                }
            }),
        ]);

        // If the commit is already handled we're good! We don't need to schedule or
        // dispatch a new deploy.
        if (compareResult.data.status !== "behind") return deployItem;

        if (canDispatchDeploy) {
            // We can't dispatch a deploy over a scheduled deployment. If
            // `canDispatchDeploy && deployItem.scheduledDeployment === null` then that
            // should be handled above.
            assert(deployItem.scheduledDeployment === null);

            return dispatch(context, deployItem, newCommitSha);
        }

        return context.tracer.withSpan("Schedule deploy workflow", async (context, span) => {
            span.addData({
                deploy: {
                    newCommit: newCommitSha,
                },
            });

            let nextDeployableTime = deployItem.scheduledDeployment?.nextDeployableTime ?? null;

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

                if (
                    nextDeployableTime === null ||
                    nextDeployableTime.getTime() < newNextDeployableTime.getTime()
                ) {
                    nextDeployableTime = newNextDeployableTime;

                    // Ok if multiple schedules are created since the `ScheduleDeploy` job is
                    // designed to be idempotent anyway.
                    await context.scheduler.dangerouslyCreateOnceMaintenanceJobSchedule(
                        "ScheduleDeployMaintenanceJob",
                        assertExists(nextDeployableTime),
                        {type: "ScheduleDeploy", commitSha: null},
                    );
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
            return DeployTable.directlyUpdateItem(context, newDeployItem);
        });
    };

    await context.dynamo.retryTransaction(context => dispatchOrSchedule(context, null));
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

    return captureResultPromise(async () => {
        let attemptCount = 0;

        // After we execute
        // `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` the
        // workflow run is started asynchronously. Keep retrying until we find a
        // matching deploy run.
        while (true) {
            attemptCount++;

            const searchWorkflowRunsResult = await context.github.request(
                "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
                {
                    owner: githubOwner,
                    repo: githubRepo,
                    workflow_id: deployGithubWorkflowId,
                    created: dispatchedDeployment.search.createdTimeRange,
                    per_page: 100,
                },
            );

            const searchOldWorkflowRunIds = new Set(dispatchedDeployment.search.oldWorkflowRunIds);

            const workflowRun = searchWorkflowRunsResult.data.workflow_runs
                .filter(workflowRun => !searchOldWorkflowRunIds.has(workflowRun.id))
                .sort(
                    (workflowRun1, workflowRun2) =>
                        new Date(workflowRun1.created_at).getTime() -
                        new Date(workflowRun2.created_at).getTime(),
                )[0];

            if (!workflowRun) {
                if (attemptCount >= 20) {
                    throw new NotFoundError("Couldn\u2019t find workflow run for dispatch");
                } else {
                    await wait(500);
                    continue;
                }
            }

            // If the workflow has concluded, consider `dispatchedDeployment` to be unset
            // so we can dispatch a new deploy.
            if (workflowRun.conclusion !== null) return null;

            return {
                workflowRunId: workflowRun.id,
                commitSha: dispatchedDeployment.commitSha,
                search: dispatchedDeployment.search,
            };
        }
    });
}

async function resolveDeployItemOngoingDeployment(
    context: Context<DynamoContextModules & {github: GithubContextModuleBase}>,
    ongoingDeployment: DeployAttributesItem["ongoingDeployment"],
): Promise<DeployAttributesItem["ongoingDeployment"]> {
    if (ongoingDeployment === null) return null;

    const workflowRunResult = await context.github.request(
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
        {
            owner: githubOwner,
            repo: githubRepo,
            run_id: ongoingDeployment.workflowRunId,
        },
    );

    // If the workflow has concluded, consider `ongoingDeployment` to be unset
    // so we can dispatch a new deploy.
    if (workflowRunResult.data.conclusion !== null) return null;

    return ongoingDeployment;
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
            basehead: `main...${commitSha}`,
            per_page: 1,
        },
    );

    if (
        mainCompareResult.data.status !== "identical" &&
        mainCompareResult.data.status !== "behind"
    ) {
        throw new FailedPreconditionError(
            quote`Commit ${commitSha} is not present in \`main\` branch (compare status: ${mainCompareResult.data.status})`,
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
                quote`Can\u2019t deploy while there\u2019s an ongoing deploy workflow run (id: ${deployItem.ongoingDeployment.workflowRunId}, status: ${workflowRunResult.status})`,
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
                item.dispatchedDeployment?.commitSha === commitSha
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
