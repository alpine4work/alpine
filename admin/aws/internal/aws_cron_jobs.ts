import {Duration} from "aws-cdk-lib";
import {Rule, RuleTargetInput, RuleTargetInputProperties, Schedule} from "aws-cdk-lib/aws-events";
import {Construct} from "constructs";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {cronJobs} from "~/admin/cron/cron_jobs.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {assert} from "~/shared/helpers/control/assert.js";
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
                        message: new MaintenanceJobRuleTargetInput(cronJob.job),
                    }),
                ],
            });
        }
    }
}

class MaintenanceJobRuleTargetInput extends RuleTargetInput {
    private readonly _job: MaintenanceJobDescription;

    constructor(job: MaintenanceJobDescription) {
        super();
        this._job = job;
    }

    public override bind(): RuleTargetInputProperties {
        const jobString = JSON.stringify(this._job);

        // There may be a way to escape the characters used by AWS for variable
        // interpolation but avoid the problem for now by disallowing these characters
        // in `jobString`.
        assert(!/[<>]/.test(jobString), "Maintenance job description must not contain `<` or `>`");

        return {
            // eslint-disable-next-line string-quotes
            inputTemplate: `{"type":"Maintenance","sendTime":"<aws.events.event.ingestion-time>","delaySeconds":0,"job":${jobString},"tracerContext":null}`,
            inputPathsMap: {},
        };
    }
}
