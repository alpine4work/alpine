import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobSenderBase} from "~/server/jobs/core/job_sender.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

export class JobsContextModule
    extends ContextModuleBase<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
    }>
    implements ForkableContextModuleBase
{
    private readonly _sender!: JobSenderBase;

    private constructor(sender: JobSenderBase | null) {
        super();

        if (sender !== null) {
            this._sender = sender;
        } else {
            // May only construct an uninitialized context module in tests.
            assert(process.env.NODE_ENV === "test");

            Object.defineProperty(this, "_sender", {
                configurable: true,
                get: () => {
                    throw new InternalError("Job sender has not been initialized");
                },
            });
        }
    }

    public static new(sender: JobSenderBase) {
        return new JobsContextModule(sender);
    }

    /**
     * Sends a job to our job queue for processing. Will be batched with other jobs
     * sent from the same process in a short window of time.
     *
     * The first job in a batch will need to wait 200ms before it can be sent as we
     * accumulate other jobs.
     *
     * Doesn't guarantee the job was delivered. If the process unexpectedly ends
     * you may return a successful result to the user without the job being saved
     * in our queue. If you want to guarantee message delivery call
     * `sendImmediately()` and await.
     */
    public send(job: JobDescription, options?: {delaySeconds?: number}): void {
        this._sender.send(this._context, job, options);
    }

    /**
     * Sends a job to our job queue for processing. Will be batched with other jobs
     * sent from the same process in a short window of time.
     *
     * The first job in a batch will need to wait 200ms before it can be sent as we
     * accumulate other jobs.
     *
     * Returns a promise that resolves only once the job has been sent to the
     * queue. This means you may have to wait up to 200ms if this is the first job
     * in a batch! Avoid this function if you need fast performance.
     */
    public sendAndWait(job: JobDescription, options?: {delaySeconds?: number}): Promise<void> {
        return this._sender.sendAndWait(this._context, job, options);
    }

    /**
     * Sends a job to our job queue for processing. Will not wait to batch with
     * other jobs and will be send to our queue immediately. If there's a pending
     * batch we'll send the batch along with this new job.
     *
     * Use this if you need to guarantee to the user that the job was delivered to
     * the queue. Once delivered to the queue the job will execute (if it errs we
     * retry) but the duration it will take to execute is not guaranteed.
     *
     * You can also use this to skip the maximum 200ms wait time for new jobs in
     * the queue. However, if your work needs to happen immediately a queue may not
     * even be a good idea given it can take a while for the job service to process
     * your job.
     */
    public sendImmediately(job: JobDescription, options?: {delaySeconds?: number}): Promise<void> {
        return this._sender.sendImmediately(this._context, job, options);
    }

    /**
     * Send a maintenance job to our job queue. It's dangerous to schedule
     * maintenance jobs since maintenance jobs have access to all data across our
     * system! Users should not be able to arbitrarily schedule maintenance jobs.
     */
    public dangerouslySendMaintenance(
        job: MaintenanceJobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void> {
        return this._sender.dangerouslySendMaintenance(this._context, job, options);
    }

    public fork() {
        return new JobsContextModule(this._sender);
    }

    /**
     * Create a jobs context module for tests. You can lazily initialize the
     * jobs client in a test.
     *
     * May only run in a test environment.
     */
    public static test(): JobsContextModule & {
        initialize: (sender: JobSenderBase) => void;
    } {
        assert(process.env.NODE_ENV === "test");

        const contextModule = new JobsContextModule(null);

        return Object.assign(contextModule, {
            initialize: (sender: JobSenderBase) => {
                let hasInitialized = false;
                try {
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    contextModule._sender;
                    hasInitialized = true;
                } catch {
                    hasInitialized = false;
                }
                assert(!hasInitialized, "Can not initialize job sender twice");

                Object.defineProperty(contextModule, "_sender", {
                    value: sender,
                    writable: false,
                });
            },
        });
    }
}
