import {
    IActivityPrinter,
    StackActivity,
    StackActivityMonitor,
} from "aws-cdk/lib/api/util/cloudformation/stack-activity-monitor.js";
import {exec} from "aws-cdk/lib/cli.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {generateId} from "~/shared/id/id.js";
import {TraceSpanId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * This function runs `bazel run //admin/aws:cdk -- deploy --all`.
 *
 * There should be no functional difference from running that command from bash
 * or running this function from JavaScript. Except this function provides
 * tracing for the deploy.
 *
 * The `aws-cdk` library's only publicly accessible API is its CLI tool.
 * However, the library also graciously provides its code built as individual
 * files. This allows us to hook into `aws-cdk`'s internals to add custom
 * tracing.
 */
export async function deployAws(span: TracerSpan) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalWithDefaultPrinter = StackActivityMonitor.withDefaultPrinter;

    let hasCalledOverriddenWithDefaultPrinter = false;

    // The `StackActivityMonitor` class is what's responsible for printing updates
    // to stdout during a deploy. We hook into this class so we can log updates to
    // our tracing provider.
    //
    // https://github.com/aws/aws-cdk/blob/c8e5924bbc83b91b929838518f4955dd3bbb884f/packages/aws-cdk/lib/api/util/cloudformation/stack-activity-monitor.ts#L86
    const overrideWithDefaultPrinter: typeof originalWithDefaultPrinter = function (
        this: typeof StackActivityMonitor,
        ...args
    ) {
        hasCalledOverriddenWithDefaultPrinter = true;

        const monitor = originalWithDefaultPrinter.call(this, ...args);

        let printer: IActivityPrinter =
            // @ts-expect-error: We're accessing a private property.
            monitor.printer;

        // Wrap the selected printer with our printer class...
        printer = new TracerActivityPrinter(span, printer);

        // @ts-expect-error: We're accessing a private property.
        monitor.printer = printer;

        return monitor;
    };

    try {
        StackActivityMonitor.withDefaultPrinter = overrideWithDefaultPrinter;
        await exec(["deploy", "--all"]);
    } finally {
        StackActivityMonitor.withDefaultPrinter = originalWithDefaultPrinter;
    }

    if (!hasCalledOverriddenWithDefaultPrinter) {
        span.logException(
            "Couldn't provide custom tracing",
            new InternalError(
                'Overridden "StackActivityMonitor.withDefaultPrinter" method was not called',
            ),
        );
    }
}

class TracerActivityPrinter implements IActivityPrinter {
    private readonly _span: TracerSpan;
    private readonly _printer: IActivityPrinter;

    private readonly _resourceById = new Map<
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

    constructor(span: TracerSpan, printer: IActivityPrinter) {
        this._span = span;
        this._printer = printer;
    }

    public get updateSleep() {
        return this._printer.updateSleep;
    }

    public addActivity(activity: StackActivity) {
        this._printer.addActivity(activity);
        this._addActivityForTracer(activity);
    }

    public print() {
        this._printer.print();
    }

    public start() {
        this._printer.start();
    }

    public stop() {
        this._printer.stop();
    }

    // Derived from `ActivityPrinterBase.addActivity()`:
    // https://github.com/aws/aws-cdk/blob/c8e5924bbc83b91b929838518f4955dd3bbb884f/packages/aws-cdk/lib/api/util/cloudformation/stack-activity-monitor.ts#L439-L495
    private _addActivityForTracer(activity: StackActivity) {
        const status = activity.event.ResourceStatus;
        const logicalResourceId = activity.event.LogicalResourceId;
        if (!status || !logicalResourceId) return;

        const eventTime = activity.event.Timestamp.getTime();

        if (status.endsWith("_IN_PROGRESS")) {
            const resource = getOrSetDefaultMapValue(this._resourceById, logicalResourceId, () => ({
                startTime: eventTime,
            }));

            resource.startTime = Math.min(resource.startTime, eventTime);
            resource.startStatus = status;
            resource.startStatusReason = activity.event.ResourceStatusReason;
        }

        if (isErrorStackEventResourceStatus(status)) {
            const resource = getOrSetDefaultMapValue(this._resourceById, logicalResourceId, () => ({
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
            const resource = getOrSetDefaultMapValue(this._resourceById, logicalResourceId, () => ({
                startTime: eventTime,
            }));

            resource.startTime = Math.min(resource.startTime, eventTime);
            this._resourceById.delete(logicalResourceId);

            const {span, finishSpan} = TracerSpan._startWithEndTime(
                this._span.getRoot(),
                this._span.clock,
                `CloudFormation ${logicalResourceId}`,
                {
                    traceId: this._span.traceId,
                    parentId: this._span._getSpanId(),
                    propagatedEventData: this._span._getPropagatedEventData(),
                    propagatedEventFlatData: this._span._getPropagatedEventFlatData(),
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
