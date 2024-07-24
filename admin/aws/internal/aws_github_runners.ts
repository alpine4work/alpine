import {
    Architecture,
    Ec2RunnerProvider,
    GitHubRunners,
    LambdaAccess,
    Os,
    RunnerImageComponent,
    RunnerVersion,
} from "@cloudsnorkel/cdk-github-runners";
import {Size, Stack} from "aws-cdk-lib";
import {IVpc, InstanceClass, InstanceSize, InstanceType, SubnetType} from "aws-cdk-lib/aws-ec2";
import {Construct} from "constructs";

export class AwsGithubRunners extends Construct {
    constructor(parentScope: Stack, {vpc}: {vpc: IVpc}) {
        super(parentScope, "GithubRunners");

        // 16 vCPU, 32 GiB memory
        const instanceType = InstanceType.of(InstanceClass.C6G, InstanceSize.XLARGE4);

        const runnerProvider = new Ec2RunnerProvider(this, "RunnerProvider", {
            vpc,
            // Run our GitHub runners in a public subnet so they can communicate with
            // GitHub and can download dependencies from the network. All without having to
            // go through a paid NAT gateway.
            subnetSelection: {subnetType: SubnetType.PUBLIC},

            labels: ["aws-test"],

            instanceType,
            storageSize: Size.gibibytes(10),

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

            imageBuilder: Ec2RunnerProvider.imageBuilder(this, "RunnerImageBuilder", {
                vpc,
                subnetSelection: {subnetType: SubnetType.PUBLIC},

                awsImageBuilderOptions: {instanceType},
                os: Os.LINUX_UBUNTU,
                // `c6g.4xlarge` instances use an arm64 instruction set. The "g" stands for
                // Gravitron2 processors which are arm64 processors.
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
                    RunnerImageComponent.custom({
                        name: "AptGetInstall",
                        commands: ["apt-get install -y zstd build-essential"],
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
