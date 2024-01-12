import {Duration} from "aws-cdk-lib";
import {EventField, Rule, RuleTargetInput, Schedule} from "aws-cdk-lib/aws-events";
import {Construct} from "constructs";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {cronJobs} from "~/admin/cron/cron_jobs.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export class AwsCronJobs extends Construct {
    constructor(parentConstruct: Construct, sqs: AwsSqs) {
        super(parentConstruct, "CronJobs");

        for (const cronJob of cronJobs) {
            let schedule;
            switch (cronJob.rate.type) {
                case "Minutes":
                    schedule = Schedule.rate(Duration.minutes(cronJob.rate.minutes));
                    break;
                case "Hours":
                    schedule = Schedule.rate(Duration.hours(cronJob.rate.hours));
                    break;
                default:
                    throw exhaustive(cronJob.rate);
            }

            new Rule(this, `${cronJob.name}Rule`, {
                schedule,
                targets: [
                    sqs.createJobQueueEventTarget({
                        message: RuleTargetInput.fromObject({
                            type: "Maintenance",
                            // See: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html
                            sendTime: EventField.fromPath("$.aws.events.event.ingestion-time"),
                            delaySeconds: 0,
                            job: cronJob.job,
                            tracerContext: null,
                        }),
                    }),
                ],
            });
        }
    }
}
