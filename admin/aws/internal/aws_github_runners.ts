import {
    Architecture,
    Ec2RunnerProvider,
    GitHubRunners,
    LambdaAccess,
    Os,
} from "@cloudsnorkel/cdk-github-runners";
import {Duration, Fn, RemovalPolicy, Size, Stack} from "aws-cdk-lib";
import {
    IConnectable,
    IVpc,
    InstanceClass,
    InstanceSize,
    InstanceType,
    SubnetType,
} from "aws-cdk-lib/aws-ec2";
import {ManagedPolicy, PolicyStatement, Role} from "aws-cdk-lib/aws-iam";
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {Construct} from "constructs";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsGithubRunnerAsgProvider} from "~/admin/aws/internal/aws_github_runner_asg_provider.js";
import {awsGithubRunnerImageBuilderComponents} from "~/admin/aws/internal/aws_github_runner_image_builder_components.js";
import {awsGithubTestRunnerImageBuilderComponents} from "~/admin/aws/internal/aws_github_test_runner_image_builder_components.js";
import {AwsObservability} from "~/admin/aws/internal/aws_observability.js";
import {awsServiceInstanceClass} from "~/admin/aws/internal/aws_service_instance_class.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {assert} from "~/shared/helpers/control/assert.js";

export class AwsGithubRunners extends Construct {
    /**
     * Connectables for every GitHub runner provider (test, test-ASG, and deploy).
     * Exposed so a centralized cache server can scope its ingress to just the runners
     * rather than the whole VPC.
     */
    public readonly runnerConnectables: Array<IConnectable>;

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
            // `aws_github_runners_bazel_remote.sh`. Since `@cloudsnorkel/cdk-github-runners`
            // doesn't give us a way to pass in parameters.
            bucketName: "cyberworlds-bazel-remote",
            // Security best practice to require HTTPS access.
            enforceSSL: true,
            minimumTLSVersion: 1.2,
            removalPolicy: RemovalPolicy.DESTROY,
            // Don't allow public access. We only allow access through IAM policies.
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
        // NOTE(calebmer, 2024-08-05): This instance type gives us best performance for the
        // cost based on some simple testing.
        const testInstanceClass = InstanceClass.M7G;
        const testInstanceType = InstanceType.of(testInstanceClass, InstanceSize.XLARGE2);

        // 4 vCPU, 16 GiB memory, Gravitron (ARM) processor
        //
        // We use the same instance class for our deploy GitHub runners as we do our
        // production services so when building we're building for the right architecture.
        const deployInstanceClass = awsServiceInstanceClass;
        const deployInstanceType = InstanceType.of(deployInstanceClass, InstanceSize.XLARGE2);

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

            components: awsGithubTestRunnerImageBuilderComponents(),
        });

        const testRunnerProvider = new Ec2RunnerProvider(this, "TestRunnerProvider", {
            vpc,
            // Run our GitHub runners in a public subnet so they can communicate with GitHub
            // and can download dependencies from the network. All without having to go through
            // a paid NAT gateway.
            subnetSelection: {subnetType: SubnetType.PUBLIC},

            labels: ["aws-test"],

            instanceType: testInstanceType,
            storageSize: Size.gibibytes(80),

            // The historical average discount for `m7g.2xlarge` instances is 66% according to
            // the [AWS Pricing Calculator][1]. It's fine for us to wait for spot capacity for
            // test runs and it's fine if a test run is interrupted. Since we can re-run
            // interrupted test runs with no consequences.
            //
            // NOTE(calebmer, 2024-11-12): Disabling spot capacity instances for test runners
            // for now. It's quite annoying to see a test run fail because of a terminated spot
            // instance. Consider building retry logic for spot instances that have been
            // terminated, re-enabling spot pricing, and monitoring how frequently spot
            // instances are killed. If we ever move to running our tests across multiple EC2
            // instance shards spot instances will be more attractive since each individual EC2
            // instance run should be faster.
            //
            // [1]: https://calculator.aws
            spot: false,

            imageBuilder: testImageBuilder,

            // Pass parameters to the AWS GitHub workflow through the `USER_DATA_EXTRA`
            // environment variable. We add this option to `@cloudsnorkel/cdk-github-runners`
            // through a patch.
            /* eslint-disable cyberworlds/string-quotes */
            userDataExtra: Fn.join("", [
                '{"alpineRunnerTag":"aws-test","jobQueueUrl":"',
                sqs.getJobQueueUrl(),
                '"}',
            ]),
            /* eslint-enable cyberworlds/string-quotes */

            // Tag EC2 instances so the SSM State Manager association in AwsObservability
            // installs and configures the CloudWatch Agent on them. We pass tags here (rather
            // than using `observability.installCloudWatchAgent`) because instances are
            // launched at runtime via `ec2:RunInstances`, not as CloudFormation resources.
            extraTags: [{key: "CloudWatchAgent", value: "true"}],
        });

        const testRunnerProviderRole: unknown = (testRunnerProvider as any).role;
        assert(testRunnerProviderRole instanceof Role);

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        testRunnerProviderRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        // Add the ability to send logs to CloudWatch.
        // https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/prerequisites.html
        testRunnerProviderRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
        );

        // Allow reading/writing to Bazel remote cache bucket.
        bucket.grantReadWrite(testRunnerProvider);

        // Our test workflow needs to send the `ScheduleDeploy` message to our job queue.
        sqs.grantSendJobQueueMessages(testRunnerProvider);

        // Allow writing to the tracer event stream.
        observability.grantPutToTracerEventStream(testRunnerProvider);

        // Keep the ASG-backed test runners side by side with the legacy test runners
        // during rollout so workflows can opt in gradually.
        const testRunnerAsgProvider = new AwsGithubRunnerAsgProvider(
            this,
            "TestRunnerAsgProvider",
            {
                label: "aws-test-asg",
                vpc,
                /* eslint-disable cyberworlds/string-quotes */
                userDataExtra: Fn.join("", [
                    '{"alpineRunnerTag":"aws-test-asg","jobQueueUrl":"',
                    sqs.getJobQueueUrl(),
                    '"}',
                ]),
                /* eslint-enable cyberworlds/string-quotes */
            },
        );

        bucket.grantReadWrite(testRunnerAsgProvider);
        sqs.grantSendJobQueueMessages(testRunnerAsgProvider);
        observability.grantPutToTracerEventStream(testRunnerAsgProvider);

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

                components: awsGithubRunnerImageBuilderComponents(),
            },
        );

        const deployRunnerProvider = new Ec2RunnerProvider(this, "DeployRunnerProvider", {
            vpc,
            // Run our GitHub runners in a public subnet so they can communicate with GitHub
            // and can download dependencies from the network. All without having to go through
            // a paid NAT gateway.
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
            // What's happening is the CDK tries to pass an empty string to `docker tag`. The
            // empty string comes from an earlier `docker` command that fails silently. The CDK
            // should really be logging that error but oh well. Most of the time, the earlier
            // error is because Docker has run out of space on the machine for images. We've
            // been able to fix this by increase the storage size of our deploy runner.
            storageSize: Size.gibibytes(100),

            // Do not use spot pricing for deploy GitHub runners. If a deploy is interrupted
            // production may be left in a bad state. (e.g. We interrupt during the
            // CloudFormation deploy which prevents the Cloudflare deploy from running.)
            spot: false,

            imageBuilder: deployImageBuilder,

            /* eslint-disable cyberworlds/string-quotes */

            // Pass parameters to the AWS GitHub workflow through the `USER_DATA_EXTRA`
            // environment variable. We add this option to `@cloudsnorkel/cdk-github-runners`
            // through a patch.
            userDataExtra: Fn.join("", [
                `{"alpineRunnerTag":"aws-deploy","cloudflareAccountId":${JSON.stringify(cloudflareAccountId)},"jobQueueUrl":"`,
                sqs.getJobQueueUrl(),
                '","fileProcessorJobQueueUrl":"',
                sqs.getFileProcessorJobQueueUrl(),
                '","fileProcessorHeavyJobQueueUrl":"',
                sqs.getFileProcessorHeavyJobQueueUrl(),
                '","fileProcessorLightJobQueueUrl":"',
                sqs.getFileProcessorLightJobQueueUrl(),
                '"}',
            ]),

            // Tag EC2 instances so the SSM State Manager association in AwsObservability
            // installs and configures the CloudWatch Agent on them. We pass tags here (rather
            // than using `observability.installCloudWatchAgent`) because instances are
            // launched at runtime via ec2:RunInstances, not as CloudFormation resources.
            extraTags: [{key: "CloudWatchAgent", value: "true"}],
        });

        const deployRunnerProviderRole: unknown = (deployRunnerProvider as any).role;
        assert(deployRunnerProviderRole instanceof Role);

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        deployRunnerProviderRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        // Add the ability to send logs to CloudWatch.
        // https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/prerequisites.html
        deployRunnerProviderRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
        );

        // Allow reading/writing to Bazel remote cache bucket.
        bucket.grantReadWrite(deployRunnerProvider);

        // Our deploy workflow needs to send the `ScheduleDeploy` message to our job queue.
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

        // NOTE(calebmer, 2024-07-22): `@cloudsnorkel/cdk-github-runners` is causing the
        // following deprecation warning:
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
            providers: [testRunnerProvider, testRunnerAsgProvider, deployRunnerProvider],
            setupAccess: LambdaAccess.noAccess(),
            webhookAccess: LambdaAccess.lambdaUrl(),
        });

        this.runnerConnectables = [testRunnerProvider, testRunnerAsgProvider, deployRunnerProvider];
    }
}
