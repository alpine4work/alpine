import chalk from "chalk";
import {differenceInHours} from "date-fns";
import {isProcessExitErrorWithCode, runProcess} from "~/server/helpers/node/run_process.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {printPrettyNumber} from "~/shared/design/print_pretty_number.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {DateString, deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {getCurrentTimeZone} from "~/shared/helpers/date/time_zone.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

const githubOwner = "cyberworlds";
const githubRepo = "cyberworlds";

async function main(): Promise<{exitCode: number}> {
    const currentTime = new Date();

    let compareCommitSha = process.argv[2];

    // Use the current commit if no argument was provided.
    if (!compareCommitSha) {
        compareCommitSha = (await runProcess("git", ["rev-parse", "HEAD"])).trim();
    }

    // eslint-disable-next-line no-global-fetch
    const response = await fetch("https://cyberworlds.dev/api/internal/deploy");

    const deploy:
        | {
              ok: true;
              activeCommitSha: string;
              ongoingDeployment: {
                  commitSha: string;
                  workflowRunId: number | null;
              } | null;
              scheduledDeployment: {
                  commitSha: string;
                  nextDeployableTime: DateString | null;
              } | null;
          }
        | {
              ok: false;
              error: SchemaSerializedValue;
          } = await response.json();

    if (!deploy.ok) {
        throw ErrorSchema.deserialize(deploy.error);
    }

    try {
        await runProcess("git", ["merge-base", "--is-ancestor", compareCommitSha, "main"]);
    } catch (error) {
        if (!isProcessExitErrorWithCode(error, 1)) {
            throw error;
        } else {
            // eslint-disable-next-line no-console
            console.log("Commit isn't in main branch.");

            return {exitCode: 1};
        }
    }

    try {
        await runProcess("git", [
            "merge-base",
            "--is-ancestor",
            compareCommitSha,
            deploy.activeCommitSha,
        ]);

        // eslint-disable-next-line no-console
        console.log("Commit is deployed.");

        return {exitCode: 0};
    } catch (error) {
        if (!isProcessExitErrorWithCode(error, 1)) {
            throw error;
        } else {
            // Continue...
        }
    }

    if (deploy.ongoingDeployment !== null) {
        try {
            await runProcess("git", [
                "merge-base",
                "--is-ancestor",
                compareCommitSha,
                deploy.ongoingDeployment.commitSha,
            ]);

            // eslint-disable-next-line no-console
            console.log("Commit is part of an ongoing deploy.");

            if (deploy.ongoingDeployment.workflowRunId !== null) {
                // eslint-disable-next-line no-console
                console.log("");
                // eslint-disable-next-line no-console
                console.log(chalk.dim(`Hint: Follow the deploy workflow run at:`));
                // eslint-disable-next-line no-console
                console.log(
                    chalk.dim.underline(
                        `https://github.com/${githubOwner}/${githubRepo}/actions/runs/${deploy.ongoingDeployment.workflowRunId}`,
                    ),
                );
            }

            return {exitCode: 1};
        } catch (error) {
            if (!isProcessExitErrorWithCode(error, 1)) {
                throw error;
            } else {
                // Continue...
            }
        }
    }

    if (deploy.scheduledDeployment !== null) {
        try {
            await runProcess("git", [
                "merge-base",
                "--is-ancestor",
                compareCommitSha,
                deploy.scheduledDeployment.commitSha,
            ]);

            // eslint-disable-next-line no-console
            console.log("Commit is scheduled to be deployed later.");

            if (deploy.scheduledDeployment.nextDeployableTime !== null) {
                const nextDeployableTime = deserializeDateString(
                    deploy.scheduledDeployment.nextDeployableTime,
                );

                const hours = differenceInHours(nextDeployableTime, currentTime);

                // eslint-disable-next-line no-console
                console.log("");
                // eslint-disable-next-line no-console
                console.log(
                    chalk.dim(
                        `Hint: Commit will be deployed ${printPrettyNumber(
                            "en-US",
                            hours,
                            "hour",
                        )} from now on ${formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                            "en-US",
                            getCurrentTimeZone(),
                            currentTime,
                            nextDeployableTime,
                            {shouldIncludeWeekday: true},
                        )}.`,
                    ),
                );
            } else if (
                deploy.ongoingDeployment !== null &&
                deploy.ongoingDeployment.workflowRunId !== null
            ) {
                // eslint-disable-next-line no-console
                console.log("");
                // eslint-disable-next-line no-console
                console.log(
                    chalk.dim(
                        `Hint: Before we can start deploying this commit, the previous deploy must`,
                    ),
                );
                // eslint-disable-next-line no-console
                console.log(chalk.dim(`finish. Follow the previous deploy workflow run at:`));
                // eslint-disable-next-line no-console
                console.log(
                    chalk.dim.underline(
                        `https://github.com/${githubOwner}/${githubRepo}/actions/runs/${deploy.ongoingDeployment.workflowRunId}`,
                    ),
                );
            }

            return {exitCode: 1};
        } catch (error) {
            if (!isProcessExitErrorWithCode(error, 1)) {
                throw error;
            } else {
                // Continue...
            }
        }
    }

    // eslint-disable-next-line no-console
    console.log("Commit isn't deployed.");
    return {exitCode: 1};
}

main()
    .then(({exitCode}) => {
        process.exit(exitCode);
    })
    .catch(error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    });
