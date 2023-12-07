import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobSenderBase} from "~/server/jobs/core/job_sender.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * An implementation of `JobSenderBase` that runs in the current
 * process in test environments instead of going through SQS. This trades the
 * delivery and retry guarantees of SQS for convenience.
 *
 * With this context module you don't need to run a local copy of SQS in tests
 * to execute jobs. By default `createTestContext()` ignores all jobs. You must
 * provide a `processJob` implementation ot `createTestContext()`.
 */
export class TestLocalJobSender extends JobSenderBase {
    private readonly _processJob: (
        context: ServerSystemActionContext,
        job: JobDescription,
        jobStartTime: Date,
    ) => Promise<void>;

    private readonly _createSystemContext: (spaceId: SpaceId) => ServerSystemActionContext;

    constructor({
        processJob,
        createSystemContext,
    }: {
        processJob: (
            context: ServerSystemActionContext,
            job: JobDescription,
            jobStartTime: Date,
        ) => Promise<void>;
        createSystemContext: (spaceId: SpaceId) => ServerSystemActionContext;
    }) {
        assert(process.env.NODE_ENV === "test");

        super();
        this._processJob = processJob;
        this._createSystemContext = createSystemContext;
    }

    public override send(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): void {
        this._send(context, job, options);
    }

    public override async sendAndWait(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void> {
        this._send(context, job, options);
    }

    public override async sendImmediately(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void> {
        this._send(context, job, options);
    }

    private _send(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        {delaySeconds = 0}: {delaySeconds?: number} = {},
    ) {
        const tracer = context.tracer.getTracer();
        const processContextModule = context.process.fork();

        const jobStartTime = new Date(Date.now() + delaySeconds * 1000);

        const run = () => {
            processContextModule.waitUntil(
                tracer.withSpan(`Process job ${job.type} (locally)`, async span => {
                    await this._createSystemContext(job.spaceId).with(
                        {tracer: new TracerContextModule(span)},
                        async context => {
                            await this._processJob(context, job, jobStartTime);
                        },
                    );
                }),
            );
        };

        if (delaySeconds === 0) {
            run();
        } else {
            setTimeout(run, delaySeconds * 1000);
        }
    }
}
