import {
    Architecture,
    Ec2RunnerProvider,
    GitHubRunners,
    LambdaAccess,
    Os,
    RunnerImageComponent,
    RunnerVersion,
} from "@cloudsnorkel/cdk-github-runners";
import {Duration, Fn, RemovalPolicy, Size, Stack} from "aws-cdk-lib";
import {IVpc, InstanceClass, InstanceSize, InstanceType, SubnetType} from "aws-cdk-lib/aws-ec2";
import {ManagedPolicy, Role} from "aws-cdk-lib/aws-iam";
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {Construct} from "constructs";
import {assert} from "~/shared/helpers/control/assert.js";

export class AwsGithubRunners extends Construct {
    constructor(
        parentScope: Stack,
        {
            vpc,
            opensearchHost,
            jobQueueUrl,
        }: {
            vpc: IVpc;
            opensearchHost: string;
            jobQueueUrl: string;
        },
    ) {
        super(parentScope, "GithubRunners");

        const bucket = new Bucket(this, "BazelRemoteBucket", {
            // Manually assign a bucket name so that we can reference it by name in
            // `aws_github_runners_bazel_remote.sh`. Since
            // `@cloudsnorkel/cdk-github-runners` doesn't give us a way to pass in
            // parameters.
            bucketName: "cyberworlds-bazel-remote",
            // Security best practice to require HTTPS access.
            enforceSSL: true,
            minimumTLSVersion: 1.2,
            // Don't allow public access. We only allow access through IAM policies.
            removalPolicy: RemovalPolicy.DESTROY,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            // If this bucket is deleted from a stack, we can delete the objects within.
            // They're cache artifacts which can easily be rebuilt.
            autoDeleteObjects: true,
            // Delete artifacts after 14 days (two weeks) if they haven't been used.
            // `bazel-remote` is configured to update the modification time when there's a
            // cache hit.
            lifecycleRules: [{expiration: Duration.days(14)}],
        });

        // 8 vCPU, 32 GiB memory, Gravitron (ARM) processor
        //
        // NOTE(calebmer, 2024-08-05): This instance type gives us best performance for
        // the cost based on some simple testing.
        const instanceClass = InstanceClass.M7G;
        const testInstanceType = InstanceType.of(instanceClass, InstanceSize.XLARGE2);

        // Use smaller instances for our deploy workflow. Most of the time our deploy
        // workflow will be sitting idle waiting for CloudFormation.
        const deployInstanceType = InstanceType.of(instanceClass, InstanceSize.MEDIUM);

        const imageBuilder = Ec2RunnerProvider.imageBuilder(this, "RunnerImageBuilder", {
            vpc,
            subnetSelection: {subnetType: SubnetType.PUBLIC},

            awsImageBuilderOptions: {
                // We can use a different size when building our image.
                instanceType: InstanceType.of(instanceClass, InstanceSize.MEDIUM),
            },
            os: Os.LINUX_UBUNTU,
            architecture: Architecture.ARM64,

            components: [
                RunnerImageComponent.requiredPackages(),
                RunnerImageComponent.runnerUser(),
                RunnerImageComponent.git(),
                RunnerImageComponent.githubCli(),
                RunnerImageComponent.awsCli(),
                RunnerImageComponent.docker(),
                RunnerImageComponent.githubRunner(RunnerVersion.latest()),

                // Installs:
                //
                // - `zstd` for better GitHub `actions/cache` compression/decompression
                //   performance.
                // - `build-essential` which includes `gcc` and `make` among other common
                //   build tools.
                // - `nodejs` since we need to run `aws_github_runners_bazel_remote_cache.cjs`
                //   before anything from Bazel.
                RunnerImageComponent.custom({
                    name: "AptGetInstall",
                    commands: [
                        `apt-get install -y ${Array.from(
                            new Set([
                                // Better GitHub `actions/cache` compression/decompression performance.
                                "zstd",
                                // Includes `gcc` and `make` among other common build tools. Necessary for
                                // building some npm packages.
                                "build-essential",
                                // We need run a small `aws_github_runners_bazel_remote_cache.cjs` server to
                                // enable remote caching before anything is built by Bazel.
                                "nodejs",

                                // Dependencies required by Playwright for running Chromium:
                                // https://github.com/microsoft/playwright/blob/3049d99bc8c76799817585a359502368bd6ba366/packages/playwright-core/src/server/registry/nativeDeps.ts#L414-L437
                                //
                                // We could also run `playwright install-deps` but putting them on the machine
                                // image is more efficient.
                                "libasound2",
                                "libatk-bridge2.0-0",
                                "libatk1.0-0",
                                "libatspi2.0-0",
                                "libcairo2",
                                "libcups2",
                                "libdbus-1-3",
                                "libdrm2",
                                "libgbm1",
                                "libglib2.0-0",
                                "libnspr4",
                                "libnss3",
                                "libpango-1.0-0",
                                "libwayland-client0",
                                "libx11-6",
                                "libxcb1",
                                "libxcomposite1",
                                "libxdamage1",
                                "libxext6",
                                "libxfixes3",
                                "libxkbcommon0",
                                "libxrandr2",

                                // Dependencies required by Playwright for running WebKit:
                                // https://github.com/microsoft/playwright/blob/3049d99bc8c76799817585a359502368bd6ba366/packages/playwright-core/src/server/registry/nativeDeps.ts#L468-L523
                                //
                                // We could also run `playwright install-deps` but putting them on the machine
                                // image is more efficient.
                                "libsoup-3.0-0",
                                "libenchant-2-2",
                                "gstreamer1.0-libav",
                                "gstreamer1.0-plugins-bad",
                                "gstreamer1.0-plugins-base",
                                "gstreamer1.0-plugins-good",
                                "libicu70",
                                "libatk-bridge2.0-0",
                                "libatk1.0-0",
                                "libcairo2",
                                "libdbus-1-3",
                                "libdrm2",
                                "libegl1",
                                "libepoxy0",
                                "libevdev2",
                                "libffi7",
                                "libfontconfig1",
                                "libfreetype6",
                                "libgbm1",
                                "libgdk-pixbuf-2.0-0",
                                "libgles2",
                                "libglib2.0-0",
                                "libglx0",
                                "libgstreamer-gl1.0-0",
                                "libgstreamer-plugins-base1.0-0",
                                "libgstreamer1.0-0",
                                "libgtk-3-0",
                                "libgudev-1.0-0",
                                "libharfbuzz-icu0",
                                "libharfbuzz0b",
                                "libhyphen0",
                                "libjpeg-turbo8",
                                "liblcms2-2",
                                "libmanette-0.2-0",
                                "libnotify4",
                                "libopengl0",
                                "libopenjp2-7",
                                "libopus0",
                                "libpango-1.0-0",
                                "libpng16-16",
                                "libproxy1v5",
                                "libsecret-1-0",
                                "libwayland-client0",
                                "libwayland-egl1",
                                "libwayland-server0",
                                "libwebpdemux2",
                                "libwoff1",
                                "libx11-6",
                                "libxcomposite1",
                                "libxdamage1",
                                "libxkbcommon0",
                                "libxml2",
                                "libxslt1.1",
                                "libx264-163",
                                "libatomic1",
                                "libevent-2.1-7",
                                // Playwright errs if this isn't installed when running WebKit, but it's not
                                // present in the list we linked above.
                                "libxt6",
                            ]),
                        ).join(" ")}`,
                    ],
                }),
            ],
        });

        const testRunnerProvider = new Ec2RunnerProvider(this, "TestRunnerProvider", {
            vpc,
            // Run our GitHub runners in a public subnet so they can communicate with
            // GitHub and can download dependencies from the network. All without having to
            // go through a paid NAT gateway.
            subnetSelection: {subnetType: SubnetType.PUBLIC},

            labels: ["aws-test"],

            instanceType: testInstanceType,
            storageSize: Size.gibibytes(30),

            // Use spot instances to save money. It's ok if test runs are interrupted. We
            // can retry processing the test job. As of 2024-07-23 here's the pricing for
            // `c6g.4xlarge`:
            //
            // - On-demand: $0.544 hourly ([source][1])
            // - Spot in `us-east-1`: $0.2079 hourly ([source][2], 62% cheaper than on-demand)
            // - Spot in `ap-south-2`: $0.094 hourly ([source][2], 83% cheaper than on-demand)
            //
            // [1]: https://aws.amazon.com/ec2/pricing/on-demand
            // [2]: https://aws.amazon.com/ec2/spot/pricing
            spot: true,

            imageBuilder,
        });

        const testRunnerProviderRole: unknown = (testRunnerProvider as any).role;
        assert(testRunnerProviderRole instanceof Role);

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        testRunnerProviderRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        // Allow reading/writing to Bazel remote cache bucket.
        bucket.grantReadWrite(testRunnerProvider);

        const deployRunnerProvider = new Ec2RunnerProvider(this, "DeployRunnerProvider", {
            vpc,
            // Run our GitHub runners in a public subnet so they can communicate with
            // GitHub and can download dependencies from the network. All without having to
            // go through a paid NAT gateway.
            subnetSelection: {subnetType: SubnetType.PUBLIC},

            labels: ["aws-deploy"],

            instanceType: deployInstanceType,
            storageSize: Size.gibibytes(30),

            // Use spot instances to save money. It's ok if test runs are interrupted. We
            // can retry processing the test job.
            spot: true,

            imageBuilder,

            userDataExtra: Fn.join("", [
                '{"opensearchHost":"',
                opensearchHost,
                '","jobQueueUrl":"',
                jobQueueUrl,
                '","edgeServiceUrl":"https://cyberworlds.dev"}',
            ]),
        });

        const deployRunnerProviderRole: unknown = (deployRunnerProvider as any).role;
        assert(deployRunnerProviderRole instanceof Role);

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        deployRunnerProviderRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        // Allow reading/writing to Bazel remote cache bucket.
        bucket.grantReadWrite(deployRunnerProvider);

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
            providers: [testRunnerProvider, deployRunnerProvider],
            setupAccess: LambdaAccess.noAccess(),
            webhookAccess: LambdaAccess.lambdaUrl(),
        });
    }
}
