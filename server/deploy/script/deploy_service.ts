import {createActionAuth} from "@octokit/auth-action";
import {CloudflareR2Client} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {GithubContextModule} from "~/server/deploy/data/github_context_module.js";
import {deploy} from "~/server/deploy/script/internal/deploy.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {
    createServerProcessContext,
    serverProcessContextOptions,
} from "~/server/node/create_server_process_context.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {HoneycombTracerClient} from "~/server/tracer/honeycomb_tracer_client.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    commitSha: {type: "string"},
    workflowRunId: {type: "string"},
    workflowRunNumber: {type: "string"},
    workflowRunAttempt: {type: "string"},
    cloudflareAccountId: {type: "string"},
    cloudflareR2AccessKeyId: {type: "string"},
    cloudflareR2SecretAccessKey: {type: "string"},
    cloudflareWorkersToken: {type: "string"},
    ...serverProcessContextOptions,
} as const;

export async function run({
    tracer,
    shutdownManager,
    honeycombClient,
    options: {
        commitSha,
        workflowRunId: workflowRunIdString,
        workflowRunNumber: workflowRunNumberString,
        workflowRunAttempt: workflowRunAttemptString,
        cloudflareAccountId,
        cloudflareR2AccessKeyId,
        cloudflareR2SecretAccessKey,
        cloudflareWorkersToken,
        ...options
    },
}: {
    tracer: TracerRoot;
    shutdownManager: ShutdownManager;
    honeycombClient: HoneycombTracerClient | null;
    options: Options;
}) {
    if (commitSha === undefined) throw new InvalidArgumentError('"commitSha" option is required');
    if (workflowRunIdString === undefined || !/^[0-9]+$/.test(workflowRunIdString))
        throw new InvalidArgumentError('"workflowRunId" integer option is required');
    if (workflowRunNumberString === undefined || !/^[0-9]+$/.test(workflowRunNumberString))
        throw new InvalidArgumentError('"workflowRunNumber" integer option is required');
    if (workflowRunAttemptString === undefined || !/^[0-9]+$/.test(workflowRunAttemptString))
        throw new InvalidArgumentError('"workflowRunAttempt" integer option is required');
    if (cloudflareAccountId === undefined)
        throw new InvalidArgumentError('"cloudflareAccountId" option is required');
    if (cloudflareR2AccessKeyId === undefined)
        throw new InvalidArgumentError('"cloudflareR2AccessKeyId" option is required');
    if (cloudflareR2SecretAccessKey === undefined)
        throw new InvalidArgumentError('"cloudflareR2SecretAccessKey" option is required');
    if (cloudflareWorkersToken === undefined)
        throw new InvalidArgumentError('"cloudflareWorkersToken" option is required');

    const workflowRunId = parseInt(workflowRunIdString, 10);
    const workflowRunNumber = parseInt(workflowRunNumberString, 10);
    const workflowRunAttempt = parseInt(workflowRunAttemptString, 10);

    // Since this only runs with `NODE_ENV=production`, we should always have a
    // Honeycomb client.
    assert(honeycombClient);

    const awsSigner = new AwsRequestSigner();

    const processContext = createServerProcessContext({
        tracer,
        shutdownManager,
        awsSigner,
        options,
    }).clone({
        github: new GithubContextModule(
            // Authenticate with the GitHub API through GitHub action environment
            // variables.
            createActionAuth().hook,
        ),
        r2: new CloudflareR2ContextModule(
            new CloudflareR2Client({
                accountId: cloudflareAccountId,
                accessKeyId: cloudflareR2AccessKeyId,
                secretAccessKey: cloudflareR2SecretAccessKey,
            }),
        ),
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
