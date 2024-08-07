import {deploy} from "~/server/deploy/data/deploy_table.js";
import {GithubContextModule} from "~/server/deploy/data/github_context_module.js";
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
        ...serverProcessContextParseOptions,
    },
    run: async ({tracer, options: {commitSha, workflowRunId: workflowRunIdString, ...options}}) => {
        if (commitSha === undefined)
            throw new InvalidArgumentError('"commitSha" option is required');
        if (workflowRunIdString === undefined || !/^[0-9]+$/.test(workflowRunIdString))
            throw new InvalidArgumentError('"workflowRunId" integer option is required');

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
        });

        await deploy(processContext, {commitSha, workflowRunId});
    },
});
