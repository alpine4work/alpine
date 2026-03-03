import {Duration} from "aws-cdk-lib";
import {Schedule, ScheduleExpression, ScheduleTargetInput} from "aws-cdk-lib/aws-scheduler";
import {SqsSendMessage} from "aws-cdk-lib/aws-scheduler-targets";
import {Construct} from "constructs";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {cronJobs} from "~/admin/cron/cron_jobs.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export class AwsCronJobs extends Construct {
    constructor(parentConstruct: Construct, sqs: AwsSqs) {
        super(parentConstruct, "CronJobs");

        for (const cronJob of cronJobs) {
            let schedule;
            if (cronJob.rate) {
                switch (cronJob.rate.type) {
                    case "Minutes":
                        schedule = ScheduleExpression.rate(Duration.minutes(cronJob.rate.minutes));
                        break;
                    case "Hours":
                        schedule = ScheduleExpression.rate(Duration.hours(cronJob.rate.hours));
                        break;
                    default:
                        throw exhaustive(cronJob.rate);
                }
            } else if (cronJob.cron) {
                schedule = ScheduleExpression.cron(cronJob.cron);
            } else {
                throw new InvalidArgumentError("Invalid cron job configuration");
            }

            const jobString = JSON.stringify(cronJob.job);

            // There may be a way to escape the characters used by AWS for variable
            // interpolation but avoid the problem for now by disallowing these characters in
            // `jobString`.
            assert(
                !/[<>]/.test(jobString),
                "Maintenance job description must not contain `<` or `>`",
            );

            const target = new SqsSendMessage(sqs.getJobQueue(), {
                input: ScheduleTargetInput.fromObject({
                    type: "Maintenance",
                    sendTime: "<aws.scheduler.scheduled-time>",
                    delaySeconds: 0,
                    job: cronJob.job,
                    tracerContext: null,
                }),
                retryAttempts: 5,
            });

            new Schedule(this, `${cronJob.name}Schedule`, {
                schedule: schedule,
                target: target,
            });
        }
    }
}
