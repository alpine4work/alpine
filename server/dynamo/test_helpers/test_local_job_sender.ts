import {ApnsContextModuleBase, TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {afterTestEnds} from "~/server/dynamo/test_helpers/after_test_ends.js";
import {
    TestSystemActionContext,
    TestSystemActionContextModules,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {JobDescription, getJobDescriptionSpaceId} from "~/server/jobs/core/job_description.js";
import {JobSenderBase} from "~/server/jobs/core/job_sender.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * An implementation of `JobSenderBase` that runs in the current
 * process in test environments instead of going through SQS. This trades the
 * delivery and retry guarantees of SQS for convenience.
 *
 * With this context module you don't need to run a local copy of SQS in tests
 * to execute jobs. By default `createTestContext()` ignores all jobs. You must
 * provide a `processJob` implementation ot `createTestContext()`.
 */
export class TestLocalJobSender implements JobSenderBase {
    private readonly _processJob: (
        context: Context<TestSystemActionContextModules & {apns: ApnsContextModuleBase}>,
        job: JobDescription,
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>;
    private readonly _processMaintenanceJob: (
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: MaintenanceJobDescription,
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>;

    private readonly _createSystemContext: (spaceId: SpaceId) => TestSystemActionContext;
    private readonly _getProcessContext: () => ServerProcessContext;

    constructor({
        processJob,
        processMaintenanceJob = asyncNoop,
        createSystemContext,
        getProcessContext,
    }: {
        processJob: (
            context: Context<TestSystemActionContextModules & {apns: ApnsContextModuleBase}>,
            job: JobDescription,
            jobStartTime: Date,
            span: TracerSpan,
        ) => Promise<void>;
        processMaintenanceJob?: (
            context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
            job: MaintenanceJobDescription,
            jobStartTime: Date,
            span: TracerSpan,
        ) => Promise<void>;
        createSystemContext: (spaceId: SpaceId) => TestSystemActionContext;
        getProcessContext: () => ServerProcessContext;
    }) {
        assert(process.env.NODE_ENV === "test");

        this._processJob = processJob;
        this._processMaintenanceJob = processMaintenanceJob;
        this._createSystemContext = createSystemContext;
        this._getProcessContext = getProcessContext;
    }

    public send(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): void {
        this._send(context, job, options);
    }

    public async sendAndWait(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void> {
        this._send(context, job, options);
    }

    public async sendImmediately(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void> {
        this._send(context, job, options);
    }

    public async dangerouslySendMaintenance(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: MaintenanceJobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void> {
        this._sendMaintenance(context, job, options);
    }

    private _send(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        {delaySeconds = 0}: {delaySeconds?: number} = {},
    ) {
        const tracer = context.tracer.getTracer();

        // Create a new context because if we need to wait for a timeout (because of
        // `delaySeconds`) `context` will likely have been destroyed by the time the
        // timeout runs.
        const sendContext = Context.new({process: context.process.fork()});

        const jobStartTime = new Date(Date.now() + delaySeconds * 1000);

        let hasRun = false;

        const run = () => {
            assert(!hasRun);
            hasRun = true;

            sendContext.process.waitUntil(
                tracer.withSpan(`Process job ${job.type} (locally)`, async span => {
                    const spaceId = getJobDescriptionSpaceId(job);

                    await this._createSystemContext(spaceId).with(
                        {
                            tracer: new TracerContextModule(span),
                            apns: new TestApnsContextModule(),
                        },
                        async context => {
                            await this._processJob(context, job, jobStartTime, span);
                        },
                    );
                }),
            );
        };

        if (delaySeconds === 0) {
            run();
        } else {
            const timeout = createTimeout(run, delaySeconds * 1000);

            afterTestEnds(() => {
                if (!hasRun) {
                    timeout.clear();
                    run();
                }
            });
        }
    }

    private _sendMaintenance(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: MaintenanceJobDescription,
        {delaySeconds = 0}: {delaySeconds?: number} = {},
    ) {
        const tracer = context.tracer.getTracer();
        const sendContext = Context.new({process: context.process.fork()});

        const jobStartTime = new Date(Date.now() + delaySeconds * 1000);

        let hasRun = false;

        const run = () => {
            assert(!hasRun);
            hasRun = true;

            sendContext.process.waitUntil(
                tracer.withSpan(`Process maintenance job ${job.type} (locally)`, async span => {
                    await this._processMaintenanceJob(
                        this._getProcessContext().clone({tracer: new TracerContextModule(span)}),
                        job,
                        jobStartTime,
                        span,
                    );
                }),
            );
        };

        if (delaySeconds === 0) {
            run();
        } else {
            const timeout = createTimeout(run, delaySeconds * 1000);

            afterTestEnds(() => {
                if (!hasRun) {
                    timeout.clear();
                    run();
                }
            });
        }
    }
}
