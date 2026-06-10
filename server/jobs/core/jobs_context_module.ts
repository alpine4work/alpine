import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobSenderBase} from "~/server/jobs/core/job_sender.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";

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
            assert(isTestNodeEnvOrAdminScenariosScript);

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
     * sent synchronously.
     *
     * Doesn't guarantee the job was delivered. If the process unexpectedly ends you
     * may return a successful result to the user without the job being saved in our
     * queue. If you want to guarantee message delivery call `sendAndWait()`.
     *
     * Before 2025-08-06 we used to wait 100ms and batch together any jobs sent during
     * this time window. However, adding this delay hurts jobs where latency matters
     * (e.g. `NotificationEvent` where the job is responsible for sending push
     * notifications and bot webhooks). Batching every 100ms was purely a cost
     * optimization. Given SQS is cheap compared to other services we use (like
     * DynamoDB) our new perspective is we're going to favor speed over cost until SQS
     * costs become an issue.
     */
    public send(job: JobDescription, options?: {delaySeconds?: number}): void {
        this._sender.send(this._context, job, options);
    }

    /**
     * Sends a job to our job queue for processing. Will be batched with other jobs
     * sent synchronously.
     *
     * Returns a promise that resolves only once the job has been sent to the queue.
     * When this function resolves, you're guaranteed the message has been delivered.
     *
     * Before 2025-08-06 we used to wait 100ms and batch together any jobs sent during
     * this time window. However, adding this delay hurts jobs where latency matters
     * (e.g. `NotificationEvent` where the job is responsible for sending push
     * notifications and bot webhooks). Batching every 100ms was purely a cost
     * optimization. Given SQS is cheap compared to other services we use (like
     * DynamoDB) our new perspective is we're going to favor speed over cost until SQS
     * costs become an issue.
     */
    public sendAndWait(job: JobDescription, options?: {delaySeconds?: number}): Promise<void> {
        return this._sender.sendAndWait(this._context, job, options);
    }

    /**
     * Send a maintenance job to our job queue. It's dangerous to schedule maintenance
     * jobs since maintenance jobs have access to all data across our system! Users
     * should not be able to arbitrarily schedule maintenance jobs.
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
     * Create a jobs context module for tests. You can lazily initialize the jobs
     * client in a test.
     *
     * May only run in a test environment.
     */
    public static test(): JobsContextModule & {
        initialize: (sender: JobSenderBase) => void;
    } {
        assert(isTestNodeEnvOrAdminScenariosScript);

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
