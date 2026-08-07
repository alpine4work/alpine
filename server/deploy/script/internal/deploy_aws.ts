import type {StackEvent} from "@aws-sdk/client-cloudformation";
import {HistoryActivityPrinter, exec} from "aws-cdk/lib";
import {ErrorBase, InternalError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TraceSpanId} from "~/shared/id/types/id_types.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

// Derived from:
// https://github.com/aws/aws-cdk-cli/blob/4bd61490bf8d65b952f260bc99af93b9f70befe2/packages/%40aws-cdk/tmp-toolkit-helpers/src/payloads/stack-activity.ts#L36-L61
type StackActivity = {
    readonly deployment: string;
    readonly event: StackEvent;
};

/**
 * This function runs `bazel run //admin/aws:cdk -- deploy --all`.
 *
 * There should be no functional difference from running that command from bash or
 * running this function from JavaScript. Except this function provides tracing for
 * the deploy.
 *
 * The `aws-cdk` library's only publicly accessible API is its CLI tool. However,
 * the library also graciously provides its code built as individual files. This
 * allows us to hook into `aws-cdk`'s internals to add custom tracing.
 */
export async function deployAws(parentSpan: TracerSpan) {
    const resourceById = new Map<
        string,
        {
            startTime: number;
            startStatus?: string;
            startStatusReason?: string;
            errorStatus?: string;
            errorStatusReason?: string;
            error?: ErrorBase;
            otherErrors?: Array<ErrorBase>;
        }
    >();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalActivity = assertExists(HistoryActivityPrinter.prototype.activity);

    // The `HistoryActivityPrinter` class is what's responsible for printing updates to
    // stdout during a deploy. We hook into this class so we can log updates to our
    // tracing provider.
    //
    // https://github.com/aws/aws-cdk-cli/blob/4bd61490bf8d65b952f260bc99af93b9f70befe2/packages/%40aws-cdk/tmp-toolkit-helpers/src/private/activity-printer/history.ts#L14
    const overrideActivity: typeof originalActivity = function (
        this: typeof HistoryActivityPrinter,
        ...args: [StackActivity]
    ) {
        addActivityForTracer(args[0]);
        return originalActivity.call(this, ...args);
    };

    try {
        HistoryActivityPrinter.prototype.activity = overrideActivity;
        await exec([
            "deploy",
            "--all",
            // Make sure `HistoryActivityPrinter` is used which we override with custom
            // logging.
            "--progress=events",
            // Never ask for approval in CI for IAM or security group related changes. Instead
            // of requiring approval when `cdk deploy` is run we have a separate mechanism to
            // get approval.
            //
            // `//admin/aws:write_aws_app_templates` makes sure we have the full CloudFormation
            // template written to our repository (e.g. the
            // `admin/aws/templates/cyberworlds_stack.yaml` file). Any change to these template
            // files requires a code review from our production engineering group. Who are
            // trusted by the organization to carefully review changes to our AWS
            // infrastructure to make sure there security vulnerabilities aren't introduced.
            //
            // Therefore, if tests have passed on our `main` branch for this commit that means
            // approval for any IAM or security group changes has already been granted.
            //
            // See the documentation for this property here:
            // https://docs.aws.amazon.com/cdk/v2/guide/cli.html
            "--require-approval=never",
        ]);
    } finally {
        HistoryActivityPrinter.prototype.activity = originalActivity;
    }

    // Derived from `ActivityPrinterBase.addActivity()`:
    // https://github.com/aws/aws-cdk/blob/c8e5924bbc83b91b929838518f4955dd3bbb884f/packages/aws-cdk/lib/api/util/cloudformation/stack-activity-monitor.ts#L439-L495
    function addActivityForTracer(activity: StackActivity) {
        const status = activity.event.ResourceStatus;
        const logicalResourceId = activity.event.LogicalResourceId;
        if (!status || !logicalResourceId) return;

        const eventTime = activity.event.Timestamp!.getTime();

        if (status.endsWith("_IN_PROGRESS")) {
            const resource = getOrSetDefaultMapValue(resourceById, logicalResourceId, () => ({
                startTime: eventTime,
            }));

            resource.startTime = Math.min(resource.startTime, eventTime);
            resource.startStatus = status;
            resource.startStatusReason = activity.event.ResourceStatusReason;
        }

        if (isErrorStackEventResourceStatus(status)) {
            const resource = getOrSetDefaultMapValue(resourceById, logicalResourceId, () => ({
                startTime: eventTime,
            }));

            const error = new InternalError(
                `Resource update failed ${JSON.stringify(status)}${
                    activity.event.ResourceStatusReason !== undefined
                        ? `: ${activity.event.ResourceStatusReason}`
                        : ""
                }`,
            );

            if (resource.errorStatus === undefined) {
                resource.startTime = Math.min(resource.startTime, eventTime);
                resource.errorStatus = status;
                resource.errorStatusReason = activity.event.ResourceStatusReason;
                resource.error = error;
            } else {
                (resource.otherErrors ??= []).push(error);
            }
        }

        if (status.endsWith("_COMPLETE") || status.endsWith("_FAILED")) {
            const resource = getOrSetDefaultMapValue(resourceById, logicalResourceId, () => ({
                startTime: eventTime,
            }));

            resource.startTime = Math.min(resource.startTime, eventTime);
            resourceById.delete(logicalResourceId);

            const {span, finishSpan} = TracerSpan._startWithEndTime(
                parentSpan.getRoot(),
                parentSpan.clock,
                `CloudFormation ${logicalResourceId}`,
                {
                    traceId: parentSpan.traceId,
                    parentId: parentSpan._getSpanId(),
                    propagatedEventData: parentSpan._getPropagatedEventData(),
                    propagatedEventFlatData: parentSpan._getPropagatedEventFlatData(),
                },
                generateId<TraceSpanId>(),
                resource.startTime,
            );

            span.addData({
                aws: {
                    cloudformation: {
                        logicalResourceId,
                        physicalResourceId: activity.event.PhysicalResourceId,
                        resourceType: activity.event.ResourceType,
                        startStatus: resource.startStatus,
                        startStatusReason: resource.startStatusReason,
                        errorStatus: resource.errorStatus,
                        errorStatusReason: resource.errorStatusReason,
                        finishStatus: status,
                        finishStatusReason: activity.event.ResourceStatusReason,
                    },
                },
            });

            if (resource.error) {
                span.addException(resource.error);
            }

            for (const otherError of resource.otherErrors ?? []) {
                span.logException("Additional exception", otherError);
            }

            finishSpan(eventTime);
        }
    }
}

function isErrorStackEventResourceStatus(status: string) {
    return (
        status.endsWith("_FAILED") ||
        status === "ROLLBACK_IN_PROGRESS" ||
        status === "UPDATE_ROLLBACK_IN_PROGRESS"
    );
}
