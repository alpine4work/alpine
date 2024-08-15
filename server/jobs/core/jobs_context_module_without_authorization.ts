import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobSenderBase} from "~/server/jobs/core/job_sender.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

export class JobsContextModuleWithoutAuthorization<
        Modules extends {
            process: ProcessContextModule;
            tracer: TracerContextModule;
        } = {
            process: ProcessContextModule;
            tracer: TracerContextModule;
        },
    >
    extends ContextModuleBase<Modules>
    implements ForkableContextModuleBase
{
    protected readonly _sender: JobSenderBase;

    protected constructor(sender: JobSenderBase | null) {
        super();
        this._sender = sender!;

        if (sender === null) {
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
        return new JobsContextModuleWithoutAuthorization(sender);
    }

    /**
     * Same as `JobsContextModule.send()` but doesn't authorize that we're allowed
     * to send the job.
     */
    public dangerouslySendWithoutAuthorization(
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): void {
        return this._sender.dangerouslySendWithoutAuthorization(this._context, job, options);
    }

    /**
     * Same as `JobsContextModule.sendAndWait()` but doesn't authorize that we're
     * allowed to send the job.
     */
    public dangerouslySendAndWaitWithoutAuthorization(
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void> {
        return this._sender.dangerouslySendAndWaitWithoutAuthorization(this._context, job, options);
    }

    /**
     * Same as `JobsContextModule.sendImmediately()` but doesn't authorize that
     * we're allowed to send the job.
     */
    public dangerouslySendImmediatelyWithoutAuthorization(
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void> {
        return this._sender.dangerouslySendImmediatelyWithoutAuthorization(
            this._context,
            job,
            options,
        );
    }

    public fork() {
        return new JobsContextModuleWithoutAuthorization(this._sender);
    }
}
