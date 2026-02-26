import {TestApnsContextModule} from "~/server/context/apns_context_module_base.js";
import {PushContextModules} from "~/server/context/push_context_modules.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {TestWebPushContextModule} from "~/server/context/web_push_context_module.js";
import {NoopSlackContextModule} from "~/server/integrations/slack/noop_slack_context_module.js";
import {JobDescription, getJobDescriptionSpaceId} from "~/server/jobs/core/job_description.js";
import {JobSenderBase} from "~/server/jobs/core/job_sender.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {
    TestSystemActionContext,
    TestSystemActionContextModules,
} from "~/server/spaces/test_helpers/test_context.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
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
        context: Context<TestSystemActionContextModules & PushContextModules>,
        job: JobDescription,
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>;
    private readonly _processMaintenanceJob: (
        context: ServerProcessContext,
        job: MaintenanceJobDescription,
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>;

    private readonly _createSystemContext: (spaceId: SpaceId) => TestSystemActionContext;
    private readonly _getProcessContext: () => ServerProcessContext;

    private _afterEachCallbacks: Array<() => void> = [];

    constructor({
        processJob,
        processMaintenanceJob = asyncNoop,
        createSystemContext,
        getProcessContext,
        afterEach,
    }: {
        processJob: (
            context: Context<TestSystemActionContextModules & PushContextModules>,
            job: JobDescription,
            jobStartTime: Date,
            span: TracerSpan,
        ) => Promise<void>;
        processMaintenanceJob?: (
            context: ServerProcessContext,
            job: MaintenanceJobDescription,
            jobStartTime: Date,
            span: TracerSpan,
        ) => Promise<void>;
        createSystemContext: (spaceId: SpaceId) => TestSystemActionContext;
        getProcessContext: () => ServerProcessContext;
        afterEach: (action: () => MaybePromise<void>) => void;
    }) {
        assert(process.env.NODE_ENV === "test");

        this._processJob = processJob;
        this._processMaintenanceJob = processMaintenanceJob;
        this._createSystemContext = createSystemContext;
        this._getProcessContext = getProcessContext;

        afterEach(() => {
            const callbacks = this._afterEachCallbacks;
            this._afterEachCallbacks = [];

            for (const callback of callbacks) {
                callback();
            }
        });
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
        if (TestLocalJobSender._capturedSentJobs !== null) {
            TestLocalJobSender._capturedSentJobs?.push({job, delaySeconds});
        }

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
                            webPush: new TestWebPushContextModule(),
                            slack: new NoopSlackContextModule(),
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

            this._afterEachCallbacks.push(() => {
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

            this._afterEachCallbacks.push(() => {
                if (!hasRun) {
                    timeout.clear();
                    run();
                }
            });
        }
    }

    private static _capturedSentJobs: Array<{job: JobDescription; delaySeconds: number}> | null =
        null;

    /**
     * Gives tests an easy way to capture jobs sent by some code without modifying
     * `TestContext`.
     */
    public static async captureSentJobs(
        action: () => Promise<void>,
    ): Promise<Array<{job: JobDescription; delaySeconds: number}>> {
        assert(import.meta.jest);

        assert(TestLocalJobSender._capturedSentJobs === null);
        TestLocalJobSender._capturedSentJobs = [];

        let jobs;
        try {
            await action();
        } finally {
            jobs = TestLocalJobSender._capturedSentJobs;
            TestLocalJobSender._capturedSentJobs = null;
        }

        return jobs;
    }
}
