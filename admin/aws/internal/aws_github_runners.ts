import {
    Architecture,
    FargateRunnerProvider,
    GitHubRunners,
    LambdaAccess,
    RunnerImageComponent,
    RunnerVersion,
} from "@cloudsnorkel/cdk-github-runners";
import {Stack} from "aws-cdk-lib";
import {Construct} from "constructs";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";

export class AwsGithubRunners extends Construct {
    constructor(parentScope: Stack, {vpc}: {vpc: AwsVpc}) {
        super(parentScope, "GithubRunners");

        const runnerProvider = new FargateRunnerProvider(this, "FargateRunnerProvider", {
            vpc,
            labels: ["aws-test"],
            imageBuilder: FargateRunnerProvider.imageBuilder(this, "FargateRunnerImageBuilder", {
                // Use arm64 instances since it's cheaper. From our initial [CI pricing
                // calculator][1] it's estimated x64 instances are ~25% more expensive than
                // arm64 instances.
                //
                // [1]: https://docs.google.com/spreadsheets/d/1MdwqNYwHfVeo9ShYztWSjOTf4h30x36C9R0uAutYy1I/edit
                architecture: Architecture.ARM64,
                components: [
                    RunnerImageComponent.requiredPackages(),
                    RunnerImageComponent.runnerUser(),
                    RunnerImageComponent.git(),
                    RunnerImageComponent.githubCli(),
                    RunnerImageComponent.awsCli(),
                    RunnerImageComponent.githubRunner(RunnerVersion.latest()),

                    // Installs `gcc` and `make` among other common build tools.
                    RunnerImageComponent.custom({
                        name: "BuildEssential",
                        commands: ["apt-get install -y build-essential"],
                    }),
                ],
            }),
            cpu: 16384, // 16 vCPUs
            memoryLimitMiB: 32768, // 32 GB
            ephemeralStorageGiB: 20, // First 20 is free

            // NOTE(calebmer, 2024-07-22): In theory, CI is a good use case for spot
            // capacity. However, when trying to set this up I have one test job that's
            // been running for >12 minutes and still hasn't been able to get spot
            // capacity. Without knowing too much about cloud economics, I'm guessing that
            // trying to get such a large instance (16 vCPU, the max for Fargate) is
            // competitive and so there's not available excess capacity.
            //
            // To optimize cost we could still try:
            //
            // 1. Trying to get spot capacity in a different availability zone that's less
            //    competitive
            // 2. Try to get spot capacity 2-3 times and if that doesn't work request
            //    regular capacity
            //
            // Not doing this for now due to implementation complexity.
            //
            // From our initial [CI pricing calculator][1] it's estimated spot x64
            // instances would save us 63%.
            //
            // [1]: https://docs.google.com/spreadsheets/d/1MdwqNYwHfVeo9ShYztWSjOTf4h30x36C9R0uAutYy1I/edit
            spot: false,
        });

        // NOTE(calebmer, 2024-07-22): `@cloudsnorkel/cdk-github-runners` is causing
        // the following deprecation warning:
        //
        // ```
        // [WARNING] aws-cdk-lib.aws_lambda.FunctionOptions#logFormat is deprecated.
        //   Use `loggingFormat` as a property instead.
        //   This API will be removed in the next major release.
        // ```
        //
        // [Tracking issue][1] in their repository.
        //
        // [1]: https://github.com/CloudSnorkel/cdk-github-runners/issues/596
        new GitHubRunners(this, "Runners", {
            providers: [runnerProvider],
            setupAccess: LambdaAccess.noAccess(),
            webhookAccess: LambdaAccess.apiGateway({allowedIps: LambdaAccess.githubWebhookIps()}),
        });
    }
}
