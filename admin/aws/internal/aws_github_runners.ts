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
import {ManagedPolicy, PolicyStatement, Role} from "aws-cdk-lib/aws-iam";
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {Construct} from "constructs";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsObservability} from "~/admin/aws/internal/aws_observability.js";
import {awsServiceInstanceClass} from "~/admin/aws/internal/aws_service_instance_class.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {assert} from "~/shared/helpers/control/assert.js";

export class AwsGithubRunners extends Construct {
    constructor(
        parentScope: Construct,
        {
            vpc,
            cloudflareAccountId,
            dynamo,
            sqs,
            observability,
        }: {
            vpc: IVpc;
            cloudflareAccountId: string;
            dynamo: AwsDynamo;
            sqs: AwsSqs;
            observability: AwsObservability;
        },
    ) {
        super(parentScope, "GithubRunners");

        const stack = Stack.of(this);

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
        const testInstanceClass = InstanceClass.M7G;
        const testInstanceType = InstanceType.of(testInstanceClass, InstanceSize.XLARGE2);

        // 4 vCPU, 16 GiB memory, Gravitron (ARM) processor
        //
        // We use the same instance class for our deploy GitHub runners as we do our
        // production services so when building we're building for the right
        // architecture.
        const deployInstanceClass = awsServiceInstanceClass;
        const deployInstanceType = InstanceType.of(deployInstanceClass, InstanceSize.XLARGE);

        const createImageBuilderComponents = (
            extraAptDependencies: Array<string> = [],
            {
                noInstallRecommends: extraAptDependenciesWithNoInstallRecommends = [],
            }: {
                noInstallRecommends?: Array<string>;
            } = {},
        ) => [
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

                            ...extraAptDependencies,
                        ]),
                    ).join(" ")}`,
                    ...(extraAptDependenciesWithNoInstallRecommends.length > 0
                        ? [
                              `apt-get install -y --no-install-recommends ${Array.from(
                                  new Set(extraAptDependenciesWithNoInstallRecommends),
                              ).join(" ")}`,
                          ]
                        : []),
                ],
            }),
        ];

        const testImageBuilder = Ec2RunnerProvider.imageBuilder(this, "TestRunnerImageBuilder", {
            vpc,
            subnetSelection: {subnetType: SubnetType.PUBLIC},

            os: Os.LINUX_UBUNTU,
            architecture: Architecture.ARM64,
            baseAmi: stack.formatArn({
                service: "imagebuilder",
                resource: "image",
                account: "aws",
                // Ubuntu 24.04.1 LTS (codename Noble)
                resourceName: `ubuntu-server-24-lts-arm64/x.x.x`,
            }),
            awsImageBuilderOptions: {
                // We can use a different size when building our image.
                instanceType: InstanceType.of(testInstanceClass, InstanceSize.MEDIUM),
            },

            components: createImageBuilderComponents(
                [
                    // Dependencies required by Playwright for running Chromium:
                    // https://github.com/microsoft/playwright/blob/99a36310570617222290c09b96a2026beb8b00f9/packages/playwright-core/src/server/registry/nativeDeps.ts#L252-L275
                    //
                    // We could also run `playwright install-deps` but putting them on the machine
                    // image is more efficient.
                    "libasound2t64",
                    "libatk-bridge2.0-0t64",
                    "libatk1.0-0t64",
                    "libatspi2.0-0t64",
                    "libcairo2",
                    "libcups2t64",
                    "libdbus-1-3",
                    "libdrm2",
                    "libgbm1",
                    "libglib2.0-0t64",
                    "libnspr4",
                    "libnss3",
                    "libpango-1.0-0",
                    "libx11-6",
                    "libxcb1",
                    "libxcomposite1",
                    "libxdamage1",
                    "libxext6",
                    "libxfixes3",
                    "libxkbcommon0",
                    "libxrandr2",

                    // Dependencies required by Playwright for running WebKit:
                    // https://github.com/microsoft/playwright/blob/99a36310570617222290c09b96a2026beb8b00f9/packages/playwright-core/src/server/registry/nativeDeps.ts#L305-L362
                    //
                    // We could also run `playwright install-deps` but putting them on the machine
                    // image is more efficient.
                    "gstreamer1.0-libav",
                    "gstreamer1.0-plugins-bad",
                    "gstreamer1.0-plugins-base",
                    "gstreamer1.0-plugins-good",
                    "libicu74",
                    "libatomic1",
                    "libatk-bridge2.0-0t64",
                    "libatk1.0-0t64",
                    "libcairo-gobject2",
                    "libcairo2",
                    "libdbus-1-3",
                    "libdrm2",
                    "libenchant-2-2",
                    "libepoxy0",
                    "libevent-2.1-7t64",
                    "libflite1",
                    "libfontconfig1",
                    "libfreetype6",
                    "libgbm1",
                    "libgdk-pixbuf-2.0-0",
                    "libgles2",
                    "libglib2.0-0t64",
                    "libgstreamer-gl1.0-0",
                    "libgstreamer-plugins-bad1.0-0",
                    "libgstreamer-plugins-base1.0-0",
                    "libgstreamer1.0-0",
                    "libgtk-3-0t64",
                    "libharfbuzz-icu0",
                    "libharfbuzz0b",
                    "libhyphen0",
                    "libicu74",
                    "libjpeg-turbo8",
                    "liblcms2-2",
                    "libmanette-0.2-0",
                    "libopus0",
                    "libpango-1.0-0",
                    "libpangocairo-1.0-0",
                    "libpng16-16t64",
                    "libsecret-1-0",
                    "libvpx9",
                    "libwayland-client0",
                    "libwayland-egl1",
                    "libwayland-server0",
                    "libwebp7",
                    "libwebpdemux2",
                    "libwoff1",
                    "libx11-6",
                    "libxkbcommon0",
                    "libxml2",
                    "libxslt1.1",
                    "libx264-164",
                    // Playwright errs if this isn't installed when running WebKit, but it's not
                    // present in the list we linked above.
                    "libxt6",

                    // Dependencies for fixing the following error when `DEBUG=pw:browser*` is set.
                    // https://github.com/microsoft/playwright/issues/27855#issuecomment-1789282663
                    //
                    // ```
                    // pw:browser [pid=1594][err] (MiniBrowser:1600): GLib-GIO-CRITICAL **: 18:21:12.441: g_application_quit: assertion 'G_IS_APPLICATION (application)' failed
                    // ```
                    "libfaad2",
                    "libkate1",
                    "libfdk-aac2",
                    // TODO(calebmer, 2024-09-06): The package `libwpewebkit-1.0-3` is not available
                    // in Ubuntu 24. We should try running integration tests again with
                    // `DEBUG=pw:browser*` set to see if we still need something here.
                    //
                    // "libwpewebkit-1.0-3",
                ],
                {
                    // Install `libreoffice` without any of its GUI dependencies since we'll only
                    // use the `libreoffice` CLI and we'll only use it in tests.
                    noInstallRecommends: ["libreoffice"],
                },
            ),
        });

        const testRunnerProvider = new Ec2RunnerProvider(this, "TestRunnerProvider", {
            vpc,
            // Run our GitHub runners in a public subnet so they can communicate with
            // GitHub and can download dependencies from the network. All without having to
            // go through a paid NAT gateway.
            subnetSelection: {subnetType: SubnetType.PUBLIC},

            labels: ["aws-test"],

            instanceType: testInstanceType,
            storageSize: Size.gibibytes(40),

            // The historical average discount for `m7g.2xlarge` instances is 66% according
            // to the [AWS Pricing Calculator][1]. It's fine for us to wait for spot
            // capacity for test runs and it's fine if a test run is interrupted. Since we
            // can re-run interrupted test runs with no consequences.
            //
            // NOTE(calebmer, 2024-11-12): Disabling spot capacity instances for test
            // runners for now. It's quite annoying to see a test run fail because of a
            // terminated spot instance. Consider building retry logic for spot instances
            // that have been terminated, re-enabling spot pricing, and monitoring how
            // frequently spot instances are killed. If we ever move to running our tests
            // across multiple EC2 instance shards spot instances will be more attractive
            // since each individual EC2 instance run should be faster.
            //
            // [1]: https://calculator.aws
            spot: false,

            imageBuilder: testImageBuilder,

            // Pass parameters to the AWS GitHub workflow through the `USER_DATA_EXTRA`
            // environment variable. We add this option to
            // `@cloudsnorkel/cdk-github-runners` through a patch.
            //
            // eslint-disable-next-line string-quotes
            userDataExtra: Fn.join("", ['{"jobQueueUrl":"', sqs.getJobQueueUrl(), '"}']),
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

        // Our test workflow needs to send the `ScheduleDeploy` message to our
        // job queue.
        sqs.grantSendJobQueueMessages(testRunnerProvider);

        // Allow writing to the tracer event stream.
        observability.grantPutToTracerEventStream(testRunnerProvider);

        const deployImageBuilder = Ec2RunnerProvider.imageBuilder(
            this,
            "DeployRunnerImageBuilder",
            {
                vpc,
                subnetSelection: {subnetType: SubnetType.PUBLIC},

                os: Os.LINUX_UBUNTU,
                architecture: Architecture.ARM64,
                baseAmi: stack.formatArn({
                    service: "imagebuilder",
                    resource: "image",
                    account: "aws",
                    // Ubuntu 24.04.1 LTS (codename Noble)
                    resourceName: `ubuntu-server-24-lts-arm64/x.x.x`,
                }),
                awsImageBuilderOptions: {
                    // We can use a different size when building our image.
                    instanceType: InstanceType.of(deployInstanceClass, InstanceSize.MEDIUM),
                },

                components: createImageBuilderComponents(),
            },
        );

        const deployRunnerProvider = new Ec2RunnerProvider(this, "DeployRunnerProvider", {
            vpc,
            // Run our GitHub runners in a public subnet so they can communicate with
            // GitHub and can download dependencies from the network. All without having to
            // go through a paid NAT gateway.
            subnetSelection: {subnetType: SubnetType.PUBLIC},

            labels: ["aws-deploy"],

            instanceType: deployInstanceType,

            // While deploying we've seen errors that looks like this:
            //
            // ```
            // Error parsing reference: "" is not a valid repository/tag: invalid reference format
            // CyberworldsStack:  fail: docker tag  989696362649.dkr.ecr.us-east-1.amazonaws.com/cdk-hnb659fds-container-assets-989696362649-us-east-1:8aee93c722a5c61b80900ee247cef3325628c82f67c04546578ee86201c85608 exited with error code 1: Error parsing reference: "" is not a valid repository/tag: invalid reference format
            //
            // Deployment failed: Error: Failed to publish asset 091963b18f73e434496e11a8620f6cffe015aca766d99e12d018cd29f243d73c:current_account-us-east-1
            //     at Deployments.publishSingleAsset (/home/runner/_work/cyberworlds/cyberworlds/bazel-bin/server/deploy/script/script.sh.runfiles/cyberworlds/node_modules/.aspect_rules_js/aws-cdk@2.149.0/node_modules/aws-cdk/lib/api/deployments.js:276:19)
            //     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
            //     at async Object.publishAsset (/home/runner/_work/cyberworlds/cyberworlds/bazel-bin/server/deploy/script/script.sh.runfiles/cyberworlds/node_modules/.aspect_rules_js/aws-cdk@2.149.0/node_modules/aws-cdk/lib/cdk-toolkit.js:182:13)
            //     at async /home/runner/_work/cyberworlds/cyberworlds/bazel-bin/server/deploy/script/script.sh.runfiles/cyberworlds/node_modules/.aspect_rules_js/aws-cdk@2.149.0/node_modules/aws-cdk/lib/util/work-graph.js:94:21
            // ```
            //
            // What's happening is the CDK tries to pass an empty string to `docker tag`.
            // The empty string comes from an earlier `docker` command that fails silently.
            // The CDK should really be logging that error but oh well. Most of the
            // time, the earlier error is because Docker has run out of space on the
            // machine for images. We've been able to fix this by increase the storage size
            // of our deploy runner.
            storageSize: Size.gibibytes(100),

            // Do not use spot pricing for deploy GitHub runners. If a deploy is
            // interrupted production may be left in a bad state. (e.g. We interrupt during
            // the CloudFormation deploy which prevents the Cloudflare deploy from
            // running.)
            spot: false,

            imageBuilder: deployImageBuilder,

            /* eslint-disable string-quotes */

            // Pass parameters to the AWS GitHub workflow through the `USER_DATA_EXTRA`
            // environment variable. We add this option to
            // `@cloudsnorkel/cdk-github-runners` through a patch.
            userDataExtra: Fn.join("", [
                `{"cloudflareAccountId":${JSON.stringify(cloudflareAccountId)},"jobQueueUrl":"`,
                sqs.getJobQueueUrl(),
                '","fileProcessorJobQueueUrl":"',
                sqs.getFileProcessorJobQueueUrl(),
                '","fileProcessorHeavyJobQueueUrl":"',
                sqs.getFileProcessorHeavyJobQueueUrl(),
                '","fileProcessorLightJobQueueUrl":"',
                sqs.getFileProcessorLightJobQueueUrl(),
                '"}',
            ]),

            /* eslint-enable string-quotes */
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

        // Our deploy workflow needs to send the `ScheduleDeploy` message to our
        // job queue.
        sqs.grantSendJobQueueMessages(deployRunnerProvider);

        // Allow reading/writing to the deploy DynamoDB table.
        dynamo.grantReadWriteDataForTable(deployRunnerProvider, "Deploy");

        // Allow writing to the tracer event stream.
        observability.grantPutToTracerEventStream(deployRunnerProvider);

        deployRunnerProvider.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["sts:AssumeRole"],
                resources: [
                    `arn:aws:iam::${stack.account}:role/cdk-hnb659fds-lookup-role-*`,
                    `arn:aws:iam::${stack.account}:role/cdk-hnb659fds-file-publishing-role-*`,
                    `arn:aws:iam::${stack.account}:role/cdk-hnb659fds-image-publishing-role-*`,
                    `arn:aws:iam::${stack.account}:role/cdk-hnb659fds-deploy-role-*`,
                ],
            }),
        );

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
