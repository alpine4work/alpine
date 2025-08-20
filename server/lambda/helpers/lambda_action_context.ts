import os from "os";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    createServerBasicProcessContextModulesWithoutShutdownManager,
    serverBasicProcessContextOptions,
} from "~/server/node/create_server_basic_process_context_modules.js";
import {serviceTokenAgentOptions} from "~/server/node/create_service_token_agent.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ServerConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type LambdaActionContextOptions = ServiceOptions<typeof lambdaActionContextOptions>;

export const lambdaActionContextOptions = {
    temporaryDirectoryPath: {type: "string"},
    ...serviceTokenAgentOptions,
    ...serverBasicProcessContextOptions,
    ...omitObject(serviceCloudflareR2Options, ["fileProcessorServiceUrl"]),
} as const;

export type LambdaActionContext = Context<{
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    jobs: JobsContextModule;
    constants: ServerConstantsContextModule;
    r2: CloudflareR2ContextModule;
    files: FilesContextModule;
    cache: CacheContextModule;
    batch: BatchContextModule;
}>;

export function createLambdaActionContext({
    awsSigner,
    options,
    promiseWaiter,
    span,
    tokenAgent,
    tracer,
    fileProcessorServiceUrl,
}: {
    awsSigner: AwsRequestSigner;
    options: LambdaActionContextOptions;
    promiseWaiter: PromiseWaiter;
    span?: TracerSpan;
    tokenAgent: TokenAgent;
    tracer: TracerRoot;
    fileProcessorServiceUrl?: string;
}): LambdaActionContext {
    return Context.new({
        // NOTE(ifitzsimmons, 07-22-2025): I'm not sure that we need all of this context here
        // in AWS Lambda for instance, jobQueueUrl is useless for Lambdas that are
        // triggered via SQS -- there's no need to poll the queue
        // With that said, it's easy to just always create the context here and
        // make sure that the Lambdas have all of the secrets available in their
        // environment variables. If we start reaching env var limits, we can revisit
        // the decision to create the context the same way.
        ...createServerBasicProcessContextModulesWithoutShutdownManager({
            tracer,
            waitUntil: (promise: Promise<unknown>) => {
                promiseWaiter.waitUntil(
                    promise.catch(error => {
                        tracer.logException("Uncaught exception from `waitUntil()`", error);
                    }),
                );
            },
            awsSigner,
            options,
        }),
        cache: CacheContextModule.new(),
        batch: BatchContextModule.new(),
        tracer: new TracerContextModule(span ?? tracer),
        r2: createServiceCloudflareR2ContextModule({
            ...options,
            fileProcessorServiceUrl,
        }),
        files: new FilesContextModule({
            tokenAgent: tokenAgent,
            edgeServiceUrl: assertExists(
                options.edgeServiceUrl,
                "`edgeServiceUrl` option is required",
            ),
        }),
    });
}

export function getLambdaActionContextOptions(): LambdaActionContextOptions {
    // Parse all environment variables into options (same for all Lambda functions)
    return {
        temporaryDirectoryPath: os.tmpdir(),
        // Service token agent options
        appServicePublicKey: assertExists(
            process.env.APP_SERVICE_PUBLIC_KEY,
            "Missing APP_SERVICE_PUBLIC_KEY",
        ),
        edgeServiceFamilyPublicKey: assertExists(
            process.env.EDGE_SERVICE_FAMILY_PUBLIC_KEY,
            "Missing EDGE_SERVICE_FAMILY_PUBLIC_KEY",
        ),
        taskRealtimeServicePublicKey: assertExists(
            process.env.TASK_REALTIME_SERVICE_PUBLIC_KEY,
            "Missing TASK_REALTIME_SERVICE_PUBLIC_KEY",
        ),
        jobQueueServicePublicKey: assertExists(
            process.env.JOB_QUEUE_SERVICE_PUBLIC_KEY,
            "Missing JOB_QUEUE_SERVICE_PUBLIC_KEY",
        ),
        fileProcessorServicePublicKey: assertExists(
            process.env.FILE_PROCESSOR_SERVICE_PUBLIC_KEY,
            "Missing FILE_PROCESSOR_SERVICE_PUBLIC_KEY",
        ),
        servicePrivateKey: assertExists(
            process.env.FILE_PROCESSOR_SERVICE_PRIVATE_KEY,
            "Missing FILE_PROCESSOR_SERVICE_PRIVATE_KEY",
        ),
        tokenAgentSecret: assertExists(
            process.env.TOKEN_AGENT_SECRET,
            "Missing TOKEN_AGENT_SECRET",
        ),

        // Server process context options (simplified for Lambda)
        // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): remove these options
        ensureLocalCachePath: process.env.ENSURE_LOCAL_CACHE_PATH || "/tmp/cache",
        dynamoLocalPort: process.env.DYNAMO_LOCAL_PORT || "8000", // Not used in production Lambda
        jobQueueUrl: process.env.JOB_QUEUE_URL || "not-used",
        fileProcessorJobQueueUrl: process.env.FILE_PROCESSOR_JOB_QUEUE_URL || "not-used",
        edgeServiceUrl: process.env.EDGE_SERVICE_URL || "not-used",

        // Cloudflare R2 options
        cloudflareR2LocalDataPath: process.env.CLOUDFLARE_R2_LOCAL_DATA_PATH || "/tmp/r2", // Not used in
        cloudflareAccountId: assertExists(
            process.env.CLOUDFLARE_ACCOUNT_ID,
            "Missing CLOUDFLARE_ACCOUNT_ID",
        ),
        cloudflareR2AccessKeyId: assertExists(
            process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
            "Missing CLOUDFLARE_R2_ACCESS_KEY_ID",
        ),
        cloudflareR2SecretAccessKey: assertExists(
            process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
            "Missing CLOUDFLARE_R2_SECRET_ACCESS_KEY",
        ),
    };
}
