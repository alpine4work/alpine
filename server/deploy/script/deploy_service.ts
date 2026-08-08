import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {createActionAuth} from "@octokit/auth-action";
import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {GithubContextModule} from "~/server/deploy/data/github_context_module.js";
import {deploy} from "~/server/deploy/script/internal/deploy.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {
    createServerBasicProcessContextModules,
    serverBasicProcessContextOptions,
} from "~/server/node/create_server_basic_process_context_modules.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {TracerClient} from "~/server/tracer/tracer_client.js";
import {Context} from "~/shared/context/context.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    commitSha: {type: "string"},
    workflowRunId: {type: "string"},
    workflowRunNumber: {type: "string"},
    workflowRunAttempt: {type: "string"},
    cloudflareWorkersToken: {type: "string"},
    ...serverBasicProcessContextOptions,
    ...serviceCloudflareR2Options,
} as const;

export async function run({
    tracer,
    startupSpan,
    shutdownManager,
    honeycombClient,
    options,
}: {
    tracer: TracerRoot;
    startupSpan: TracerSpan;
    shutdownManager: ShutdownManager;
    honeycombClient: TracerClient | null;
    options: Options;
}) {
    const {
        commitSha,
        workflowRunId: workflowRunIdString,
        workflowRunNumber: workflowRunNumberString,
        workflowRunAttempt: workflowRunAttemptString,
        cloudflareWorkersToken,
        cloudflareAccountId,
    } = options;

    if (commitSha === undefined) throw new InvalidArgumentError("`commitSha` option is required");
    if (workflowRunIdString === undefined || !/^[0-9]+$/.test(workflowRunIdString))
        throw new InvalidArgumentError("`workflowRunId` integer option is required");
    if (workflowRunNumberString === undefined || !/^[0-9]+$/.test(workflowRunNumberString))
        throw new InvalidArgumentError("`workflowRunNumber` integer option is required");
    if (workflowRunAttemptString === undefined || !/^[0-9]+$/.test(workflowRunAttemptString))
        throw new InvalidArgumentError("`workflowRunAttempt` integer option is required");
    if (cloudflareAccountId === undefined)
        throw new InvalidArgumentError("`cloudflareAccountId` option is required");
    if (cloudflareWorkersToken === undefined)
        throw new InvalidArgumentError("`cloudflareWorkersToken` option is required");

    const workflowRunId = parseInt(workflowRunIdString, 10);
    const workflowRunNumber = parseInt(workflowRunNumberString, 10);
    const workflowRunAttempt = parseInt(workflowRunAttemptString, 10);

    // Since this only runs with `NODE_ENV=production`, we should always have a
    // Honeycomb client.
    assert(honeycombClient);

    const awsSigner = new AwsRequestSigner(defaultProvider());
    void awsSigner.prefetchState(startupSpan);

    const processContext = Context.new({
        ...createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
        github: new GithubContextModule(
            // Authenticate with the GitHub API through GitHub action environment variables.
            createActionAuth().hook,
        ),
        r2: createServiceCloudflareR2ContextModule(options),
    });

    await deploy(processContext, {
        commitSha,
        workflowRunId,
        workflowRunNumber,
        workflowRunAttempt,
        honeycombClient,
        cloudflareAccountId,
        cloudflareWorkersToken,
    });
}
