import {GetSecretValueCommand, SecretsManagerClient} from "@aws-sdk/client-secrets-manager";
import os from "os";
import {ServerSecrets} from "~/server/aws/server_secrets_schema.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {createLanguageModelsContextModuleForProcess} from "~/server/language_models/create_language_models_context_module_for_process.js";
import {LanguageModelsContextModuleBase} from "~/server/language_models/language_models_context_module_base.js";
import {
    createServerBasicProcessContextModulesWithoutShutdownManager,
    serverBasicProcessContextOptions,
} from "~/server/node/create_server_basic_process_context_modules.js";
import {serviceTokenAgentOptions} from "~/server/node/create_service_token_agent.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export type LambdaActionContextOptions = ServiceOptions<typeof lambdaActionContextOptions>;

export const lambdaActionContextOptions = {
    temporaryDirectoryPath: {type: "string"},
    // Used to test LLM calls against real AWS Bedrock in development. Optional.
    awsBedrockTokenForDevelopment: {type: "string", optional: true},
    ...serviceTokenAgentOptions,
    ...omitObject(serverBasicProcessContextOptions, ["kinesisTracerStreamName"]),
    ...omitObject(serviceCloudflareR2Options, ["fileProcessorServiceUrl"]),
    honeycombApiKey: {type: "string", optional: true},
} as const;

export type LambdaActionContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    jobs: JobsContextModule;
    constants: ConstantsContextModule;
    r2: CloudflareR2ContextModule;
    files: FilesContextModule;
    languageModels: LanguageModelsContextModuleBase;
    cache: CacheContextModule;
    batch: BatchContextModule;
};
export type LambdaActionContext = Context<LambdaActionContextModules>;

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
    assert(
        options.awsBedrockTokenForDevelopment === undefined ||
            process.env.NODE_ENV !== "production",
        "`awsBedrockTokenForDevelopment` must not be set in production",
    );

    return Context.new({
        // NOTE(ifitzsimmons, 07-22-2025): I'm not sure that we need all of this context
        // here in AWS Lambda for instance, jobQueueUrl is useless for Lambdas that are
        // triggered via SQS -- there's no need to poll the queue With that said, it's easy
        // to just always create the context here and make sure that the Lambdas have all
        // of the secrets available in their environment variables. If we start reaching
        // env var limits, we can revisit the decision to create the context the same way.
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
            resourceServiceUrl: assertExists(
                options.resourceServiceUrl,
                "`resourceServiceUrl` option is required",
            ),
        }),
        languageModels: createLanguageModelsContextModuleForProcess({
            awsBedrockTokenForDevelopment: options.awsBedrockTokenForDevelopment,
        }),
    });
}

async function getServiceSecretsFromArn(
    secretArn: string,
    serviceSecretsSchema: Schema<ServerSecrets>,
): Promise<ServerSecrets> {
    const client = new SecretsManagerClient({});
    const response = await client.send(
        new GetSecretValueCommand({
            SecretId: secretArn,
        }),
    );

    if (!response || !response.SecretString)
        throw new InternalError("Failed to fetch secrets from AWS Secrets Manager");

    return serviceSecretsSchema.deserialize(JSON.parse(response.SecretString));
}

export async function getLambdaActionContextOptions(
    serviceSecretsSchema: Schema<ServerSecrets>,
    span: TracerSpan,
): Promise<LambdaActionContextOptions> {
    // Get the secret ARN from environment variables
    const secretArn = assertExists(
        process.env.SECRET_ARN,
        "Missing SECRET_ARN environment variable",
    );

    // Fetch all secrets from AWS Secrets Manager
    const secret = await span.withSpan("Fetch secrets from AWS Secrets Manager", async () => {
        return await getServiceSecretsFromArn(secretArn, serviceSecretsSchema);
    });
    const awsBedrockTokenForDevelopment =
        "awsBedrockTokenForDevelopment" in secret &&
        typeof secret.awsBedrockTokenForDevelopment === "string"
            ? secret.awsBedrockTokenForDevelopment
            : undefined;

    // Parse all environment variables and secrets into options
    return {
        temporaryDirectoryPath: os.tmpdir(),
        ...secret,
        awsBedrockTokenForDevelopment,
        // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): remove these
        // options
        ensureLocalCachePath: process.env.ENSURE_LOCAL_CACHE_PATH || "/tmp/cache",
        dynamoLocalPort: process.env.DYNAMO_LOCAL_PORT || "8000", // Not used in production Lambda
        jobQueueUrl: process.env.JOB_QUEUE_URL || "not-used",
        // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
        // original job queue url
        fileProcessorJobQueueUrl: process.env.FILE_PROCESSOR_JOB_QUEUE_URL || "not-used",
        // TODO(ifitzsimmons, 2025-07-30, #add-light-and-heavy-queues)
        fileProcessorHeavyJobQueueUrl: process.env.FILE_PROCESSOR_HEAVY_JOB_QUEUE_URL || "not-used",
        fileProcessorLightJobQueueUrl: process.env.FILE_PROCESSOR_LIGHT_JOB_QUEUE_URL || "not-used",
        edgeServiceUrl: process.env.EDGE_SERVICE_URL || "not-used",
        resourceServiceUrl: process.env.RESOURCES_SERVICE_URL || "not-used",
        // Cloudflare R2 options
        cloudflareR2LocalDataPath: process.env.CLOUDFLARE_R2_LOCAL_DATA_PATH || "/tmp/r2", // Not used in
        cloudflareAccountId: assertExists(
            process.env.CLOUDFLARE_ACCOUNT_ID,
            "Missing CLOUDFLARE_ACCOUNT_ID",
        ),
    };
}
