import {
    CreateScheduleCommand,
    CreateScheduleCommandInput,
    CreateScheduleCommandOutput,
    SchedulerClient,
} from "@aws-sdk/client-scheduler";
import {parseAbsolute} from "@internationalized/date";
import {JobQueueMessageBodySchema} from "~/server/jobs/core/job_sender.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

/**
 * Context module for scheduling events with [AWS EventBridge Scheduler][1].
 *
 * [1]:
 *     https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html
 */
export abstract class SchedulerContextModuleBase extends ContextModuleBase<{
    tracer: TracerContextModule;
}> {
    /**
     * Schedule a maintenance job to run at some time in the future. This is dangerous
     * since maintenance jobs have access to all data across our product. Make sure
     * users don't have the ability to arbitrarily schedule maintenance jobs.
     *
     * `maxWindowMinutes` is the latest AWS EventBridge Scheduler may send our job to
     * the SQS queue. AWS EventBridge Scheduler may choose to send our job to the SQS
     * queue later for performance reasons.
     */
    public abstract dangerouslyCreateOnceMaintenanceJobSchedule(
        name: string,
        time: Date,
        job: MaintenanceJobDescription,
        options?: {maxWindowMinutes?: number},
    ): Promise<void>;
}

export class SchedulerContextModule extends SchedulerContextModuleBase {
    private readonly _jobQueueArn: string;
    private readonly _jobQueueRoleArn: string;
    private readonly _client: SchedulerClient;

    constructor({
        region,
        jobQueueArn,
        jobQueueRoleArn,
    }: {
        region: string;
        jobQueueArn: string;
        jobQueueRoleArn: string;
    }) {
        super();
        this._jobQueueArn = jobQueueArn;
        this._jobQueueRoleArn = jobQueueRoleArn;
        this._client = new SchedulerClient({region});
    }

    /**
     * Schedule a maintenance job to run at some time in the future. This is dangerous
     * since maintenance jobs have access to all data across our product. Make sure
     * users don't have the ability to arbitrarily schedule maintenance jobs.
     *
     * `maxWindowMinutes` is the latest AWS EventBridge Scheduler may send our job to
     * the SQS queue. AWS EventBridge Scheduler may choose to send our job to the SQS
     * queue later for performance reasons.
     */
    public async dangerouslyCreateOnceMaintenanceJobSchedule(
        name: string,
        time: Date,
        job: MaintenanceJobDescription,
        {maxWindowMinutes = 1}: {maxWindowMinutes?: number} = {},
    ) {
        const currentTime = new Date();

        if (isDateDefinitelyLessThanWithUncertaintyWindow(time, currentTime)) {
            throw new InvalidArgumentError("Can\u2019t create schedule that executes in the past");
        }

        const timeZone = "Etc/UTC";

        // Get the time in UTC for our schedule expression.
        const zonedTime = parseAbsolute(time.toISOString(), timeZone);

        const scheduleExpressionArgument =
            zonedTime.year.toString().padStart(4, "0") +
            "-" +
            zonedTime.month.toString().padStart(2, "0") +
            "-" +
            zonedTime.day.toString().padStart(2, "0") +
            "T" +
            zonedTime.hour.toString().padStart(2, "0") +
            ":" +
            zonedTime.minute.toString().padStart(2, "0") +
            ":" +
            zonedTime.second.toString().padStart(2, "0");

        await this._CreateSchedule(`Maintenance job ${job.type}`, {
            Name: name,
            ActionAfterCompletion: "DELETE",
            ScheduleExpression: `at(${scheduleExpressionArgument})`,
            ScheduleExpressionTimezone: timeZone,
            FlexibleTimeWindow:
                maxWindowMinutes === 0
                    ? {Mode: "OFF"}
                    : {
                          Mode: "FLEXIBLE",
                          MaximumWindowInMinutes: maxWindowMinutes,
                      },
            Target: {
                Arn: this._jobQueueArn,
                RoleArn: this._jobQueueRoleArn,
                Input: JSON.stringify(
                    JobQueueMessageBodySchema.serialize({
                        type: "Maintenance",
                        sendTime: currentTime,
                        // While we aren't using the SQS `delaySeconds` feature, we do want to treat this
                        // message as if it had been delayed a very long time for tracing purposes. That
                        // way `jobs.queueDurationMs` gives us a correct queue duration value.
                        delaySeconds: Math.round((time.getTime() - currentTime.getTime()) / 1000),
                        job,
                        tracerContext: null,
                    }),
                ),
            },
        });
    }

    /**
     * AWS EventBridge Scheduler [`CreateSchedule`][1] action.
     *
     * [1]:
     *     https://docs.aws.amazon.com/scheduler/latest/APIReference/API_CreateSchedule.html
     */
    private _CreateSchedule(
        targetDescription: string,
        input: CreateScheduleCommandInput,
    ): Promise<CreateScheduleCommandOutput> {
        return this._context.tracer.withSpan(
            "EventBridge Scheduler CreateSchedule",
            async (context, span) => {
                span.addData({
                    aws: {
                        eventbridge: {
                            scheduler: {
                                name: input.Name,
                                groupName: input.GroupName,
                                expression: input.ScheduleExpression,
                                expressionTimeZone: input.ScheduleExpressionTimezone,
                                maxFlexibleTimeWindowMinutes:
                                    input.FlexibleTimeWindow?.MaximumWindowInMinutes,
                                startDate: input.StartDate
                                    ? serializeDateString(input.StartDate)
                                    : undefined,
                                endDate: input.EndDate
                                    ? serializeDateString(input.EndDate)
                                    : undefined,
                                target: targetDescription,
                            },
                        },
                    },
                });

                const output = await this._client.send(new CreateScheduleCommand(input));

                span.addData({
                    aws: {
                        eventbridge: {
                            scheduler: {
                                arn: output.ScheduleArn,
                            },
                        },
                    },
                });

                return output;
            },
        );
    }
}

export class UnimplementedSchedulerContextModule extends SchedulerContextModuleBase {
    public dangerouslyCreateOnceMaintenanceJobSchedule(): Promise<void> {
        throw new UnimplementedError(
            quote`Scheduler context module is unimplemented in ${process.env.NODE_ENV}`,
        );
    }
}
