import {GithubContextModule} from "~/server/deploy/data/github_context_module.js";
import {CloudflareR2Client} from "~/server/deploy/tool/cloudflare_r2_client.js";
import {CloudflareR2ContextModule} from "~/server/deploy/tool/cloudflare_r2_context_module.js";
import {deploy} from "~/server/deploy/tool/deploy.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {runService} from "~/server/node/run_service.js";
import {InvalidArgumentError} from "~/shared/error/error.js";

runService({
    serviceName: "DeployService",
    withoutCluster: true,
    options: {
        commitSha: {type: "string"},
        workflowRunId: {type: "string"},
        cloudflareAccountId: {type: "string"},
        cloudflareAccessKeyId: {type: "string"},
        cloudflareSecretAccessKey: {type: "string"},
        ...serverProcessContextParseOptions,
    },
    run: async ({
        tracer,
        options: {
            commitSha,
            workflowRunId: workflowRunIdString,
            cloudflareAccountId,
            cloudflareAccessKeyId,
            cloudflareSecretAccessKey,
            ...options
        },
    }) => {
        if (commitSha === undefined)
            throw new InvalidArgumentError('"commitSha" option is required');
        if (workflowRunIdString === undefined || !/^[0-9]+$/.test(workflowRunIdString))
            throw new InvalidArgumentError('"workflowRunId" integer option is required');
        if (cloudflareAccountId === undefined)
            throw new InvalidArgumentError('"cloudflareAccountId" option is required');
        if (cloudflareAccessKeyId === undefined)
            throw new InvalidArgumentError('"cloudflareAccessKeyId" option is required');
        if (cloudflareSecretAccessKey === undefined)
            throw new InvalidArgumentError('"cloudflareSecretAccessKey" option is required');

        const workflowRunId = parseInt(workflowRunIdString, 10);

        const awsSigner = new AwsRequestSigner();

        const processContext = createServerProcessContext({
            tracer,
            // TODO(calebmer, 2024-08-05): The deploy service doesn't currently communicate
            // with any other services but might in the future. I need to decide whether or
            // not the server process context should contain context modules to communicate
            // with other services like `edge`. Maybe there should be a second limited
            // server process context type that doesn't need access to other services.
            tokenAgent: "Unimplemented",
            awsSigner,
            options,
        }).clone({
            github: new GithubContextModule(),
            cloudflareR2: new CloudflareR2ContextModule(
                new CloudflareR2Client({
                    accountId: cloudflareAccountId,
                    accessKeyId: cloudflareAccessKeyId,
                    secretAccessKey: cloudflareSecretAccessKey,
                }),
            ),
        });

        await deploy(processContext, {
            commitSha,
            workflowRunId,
        });
    },
});
