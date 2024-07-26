import {
    Architecture,
    Ec2RunnerProvider,
    GitHubRunners,
    LambdaAccess,
    Os,
    RunnerImageComponent,
    RunnerVersion,
} from "@cloudsnorkel/cdk-github-runners";
import {Duration, RemovalPolicy, Size, Stack} from "aws-cdk-lib";
import {IVpc, InstanceClass, InstanceSize, InstanceType, SubnetType} from "aws-cdk-lib/aws-ec2";
import {ManagedPolicy, Role} from "aws-cdk-lib/aws-iam";
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {Construct} from "constructs";
import {assert} from "~/shared/helpers/control/assert.js";

export class AwsGithubRunners extends Construct {
    constructor(parentScope: Stack, {vpc}: {vpc: IVpc}) {
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

        // 8 vCPU, 32 GiB memory, Intel (x86) processor
        const instanceType = InstanceType.of(InstanceClass.M7I, InstanceSize.XLARGE2);

        const runnerProvider = new Ec2RunnerProvider(this, "RunnerProvider", {
            vpc,
            // Run our GitHub runners in a public subnet so they can communicate with
            // GitHub and can download dependencies from the network. All without having to
            // go through a paid NAT gateway.
            subnetSelection: {subnetType: SubnetType.PUBLIC},

            labels: ["aws-test"],

            instanceType,
            storageSize: Size.gibibytes(30),

            // TODO(calebmer): Try enabling spot instances again.
            //
            // // Use spot instances to save money. It's ok if test runs are interrupted. We
            // // can retry processing the test job. As of 2024-07-23 here's the pricing for
            // // `c6g.4xlarge`:
            // //
            // // - On-demand: $0.544 hourly ([source][1])
            // // - Spot in `us-east-1`: $0.2079 hourly ([source][2], 62% cheaper than on-demand)
            // // - Spot in `ap-south-2`: $0.094 hourly ([source][2], 83% cheaper than on-demand)
            // //
            // // [1]: https://aws.amazon.com/ec2/pricing/on-demand
            // // [2]: https://aws.amazon.com/ec2/spot/pricing
            // spot: true,

            imageBuilder: Ec2RunnerProvider.imageBuilder(this, "RunnerImageBuilder", {
                vpc,
                subnetSelection: {subnetType: SubnetType.PUBLIC},

                awsImageBuilderOptions: {instanceType},
                os: Os.LINUX_UBUNTU,
                architecture: Architecture.X86_64,

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
                        commands: ["apt-get install -y zstd build-essential nodejs"],
                    }),

                    // Install Swift. Unfortunately `build_bazel_rules_swift_local_config` is not
                    // hermetic and requires Swift to be installed on the machine. So to run tests
                    // for `native/mobile/ios` we need to install Swift in our image.
                    RunnerImageComponent.custom({
                        name: "Swift",
                        commands: [
                            "mkdir /tmp/swift-install",
                            "pushd /tmp/swift-install",
                            "curl -fsSLO https://download.swift.org/swift-5.10.1-release/ubuntu2204-aarch64/swift-5.10.1-RELEASE/swift-5.10.1-RELEASE-ubuntu22.04-aarch64.tar.gz",
                            "mkdir /usr/share/swift",
                            "tar -C /usr/share/swift -xzf swift-5.10.1-RELEASE-ubuntu22.04-aarch64.tar.gz --strip-components 2",
                            "popd",
                            "rm -rf /tmp/swift-install",
                            "ln -s /usr/share/swift/bin/* /usr/bin/",
                        ],
                    }),
                ],
            }),
        });

        const runnerProviderRole: unknown = (runnerProvider as any).role;
        assert(runnerProviderRole instanceof Role);

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        runnerProviderRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        // Allow reading/writing to Bazel remote cache bucket.
        bucket.grantReadWrite(runnerProvider);

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
            webhookAccess: LambdaAccess.lambdaUrl(),
        });
    }
}
