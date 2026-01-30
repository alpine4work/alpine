import {fromDate, getLocalTimeZone, toCalendarDate} from "@internationalized/date";
import chalk from "chalk";
import {differenceInHours} from "date-fns";
import {isProcessExitErrorWithCode, runProcess} from "~/server/helpers/node/run_process.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {DateString, deserializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

const githubOwner = "cyberworlds";
const githubRepo = "cyberworlds";

async function main(): Promise<{exitCode: number}> {
    const currentTime = new Date();
    const currentDate = toCalendarDate(fromDate(currentTime, getLocalTimeZone()));

    let compareCommitSha = process.argv[2];

    // Use the current commit if no argument was provided.
    if (!compareCommitSha) {
        compareCommitSha = (await runProcess("git", ["rev-parse", "HEAD"])).trim();
    }

    // eslint-disable-next-line no-global-fetch
    const response = await fetch("https://alpine.inc/api/internal/deploy");

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
            process.stdout.write("Commit isn\u2019t in main branch.\n");

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

        process.stdout.write("Commit is deployed.\n");

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

            process.stdout.write("Commit is part of an ongoing deploy.\n");

            if (deploy.ongoingDeployment.workflowRunId !== null) {
                process.stderr.write(
                    "\n" +
                        chalk.dim(`Hint: Follow the deploy workflow run at:`) +
                        "\n" +
                        chalk.dim.underline(
                            `https://github.com/${githubOwner}/${githubRepo}/actions/runs/${deploy.ongoingDeployment.workflowRunId}`,
                        ) +
                        "\n",
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

            process.stdout.write(
                "Commit isn\u2019t deployed, but it\u2019s scheduled to be deployed later.\n",
            );

            if (deploy.scheduledDeployment.nextDeployableTime !== null) {
                const nextDeployableTime = deserializeDateString(
                    deploy.scheduledDeployment.nextDeployableTime,
                );

                const hours = differenceInHours(nextDeployableTime, currentTime);

                process.stderr.write(
                    "\n" +
                        chalk.dim(
                            `Hint: Commit will be deployed ${printPrettyNumber(
                                defaultLocale,
                                hours,
                                "hour",
                            )} from now on ${formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                                defaultLocale,
                                getCurrentTimeZone(),
                                currentDate,
                                nextDeployableTime,
                                {withWeekday: true},
                            )}.`,
                        ) +
                        "\n",
                );
            } else if (
                deploy.ongoingDeployment !== null &&
                deploy.ongoingDeployment.workflowRunId !== null
            ) {
                process.stderr.write(
                    "\n" +
                        chalk.dim(
                            `Hint: Before we can start deploying this commit, the previous deploy must`,
                        ) +
                        "\n" +
                        chalk.dim(`finish. Follow the previous deploy workflow run at:`) +
                        "\n" +
                        chalk.dim.underline(
                            `https://github.com/${githubOwner}/${githubRepo}/actions/runs/${deploy.ongoingDeployment.workflowRunId}`,
                        ) +
                        "\n",
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

    process.stdout.write("Commit isn\u2019t deployed.\n");
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
