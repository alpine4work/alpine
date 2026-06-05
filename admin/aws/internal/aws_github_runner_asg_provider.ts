import {
    Architecture,
    Ec2RunnerProvider,
    IRunnerProvider,
    IRunnerProviderStatus,
    Os,
    RunnerRuntimeParameters,
} from "@cloudsnorkel/cdk-github-runners";
import {Duration, Fn, RemovalPolicy, Stack} from "aws-cdk-lib";
import {
    IVpc,
    InstanceClass,
    InstanceSize,
    InstanceType,
    SecurityGroup,
    SubnetType,
} from "aws-cdk-lib/aws-ec2";
import {
    CfnInstanceProfile,
    IGrantable,
    ManagedPolicy,
    PolicyStatement,
    Role,
    ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {CfnImageRecipe} from "aws-cdk-lib/aws-imagebuilder";
import {ILogGroup, LogGroup, RetentionDays} from "aws-cdk-lib/aws-logs";
import {BlockPublicAccess, Bucket, BucketEncryption} from "aws-cdk-lib/aws-s3";
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {IChainable, IntegrationPattern, JsonPath, Timeout} from "aws-cdk-lib/aws-stepfunctions";
import {CallAwsService} from "aws-cdk-lib/aws-stepfunctions-tasks";
import {Construct} from "constructs";
import {awsGithubTestRunnerImageBuilderComponents} from "~/admin/aws/internal/aws_github_test_runner_image_builder_components.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const awsGithubRunnerTaskTimeout = Duration.hours(6);
const awsGithubRunnerHeartbeatTimeout = Duration.minutes(10);
const awsGithubRunnerAmiRootVolumeSizeGib = 80;
const awsGithubRunnerAmiCacheKeyPath = "/opt/alpine-runner-image/bazel-cache-key";
const awsGithubRunnerAmiSourceBundleKeyParameterName =
    "/cyberworlds/github-runners/test-runner-asg/ami-source-bundle-key";
const awsGithubRunnerAmiBazelCacheKeyParameterName =
    "/cyberworlds/github-runners/test-runner-asg/bazel-cache-key";

/* eslint-disable cyberworlds/string-quotes */
function createLinuxUserDataTemplate() {
    return `#!/bin/bash -x
TASK_TOKEN="{}"
logGroupName="{}"
runnerNamePath="{}"
runnerTokenPath="{}"
registrationURL="{}"
label="{}"
export USER_DATA_EXTRA="$(echo "{}" | base64 --decode)"
export ALPINE_RUNNER_TAG="$label"
export ALPINE_AMI_BAZEL_CACHE_KEY_PATH="${awsGithubRunnerAmiCacheKeyPath}"

setup_logs () {
  # Ship the runner bootstrap log to CloudWatch so Step Functions timeouts and
  # instance startup failures are debuggable after the machine terminates.
  cat <<EOF > /tmp/log.conf || exit 1
  {
    "logs": {
      "log_stream_name": "unknown",
      "logs_collected": {
        "files": {
          "collect_list": [
            {
              "file_path": "/var/log/runner.log",
              "log_group_name": "$logGroupName",
              "log_stream_name": "$runnerNamePath",
              "timezone": "UTC"
            }
          ]
        }
      }
    }
  }
EOF
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/tmp/log.conf || exit 2
}
setup_runtime_env () {
  # Resolve the region from IMDS so the bootstrap can use the instance role for
  # both Step Functions callbacks and the Bazel remote cache proxy.
  metadata_token=$(curl -sS -X PUT http://169.254.169.254/latest/api/token \
    -H 'x-aws-ec2-metadata-token-ttl-seconds: 21600')
  export AWS_REGION=$(curl -sS -H "x-aws-ec2-metadata-token: $metadata_token" \
    http://169.254.169.254/latest/dynamic/instance-identity/document | \
    node -e 'let data="";process.stdin.on("data",chunk=>data+=chunk);process.stdin.on("end",()=>process.stdout.write(JSON.parse(data).region));')
}
heartbeat () {
  # Match the legacy EC2 runner behavior: once bootstrap reaches the actual
  # runner handoff, keep the Step Functions task alive with heartbeats.
  while true; do
    aws stepfunctions send-task-heartbeat --task-token "$TASK_TOKEN"
    sleep 60
  done
}
action () {
  if [ "$(< RUNNER_VERSION)" = "latest" ]; then
    RUNNER_FLAGS=""
  else
    RUNNER_FLAGS="--disableupdate"
  fi

  # Preserve the provider label and append the standard started-at marker so
  # GitHub runner diagnostics stay consistent with the legacy provider.
  labelsTemplate="$label,cdkghr:started:$(date +%s)"

  # Register the ephemeral runner first, then start heartbeating only once the
  # instance is actually ready to execute workflow jobs.
  sudo -Hu runner /home/runner/config.sh --unattended --url "$registrationURL" --token "$runnerTokenPath" --ephemeral --work _work --labels "$labelsTemplate" $RUNNER_FLAGS --name "$runnerNamePath" || exit 1

  heartbeat &
  heartbeat_pid=$!
  trap 'kill "$heartbeat_pid" >/dev/null 2>&1 || true' EXIT

  # Run the stock GitHub runner as the unprivileged runner account while
  # preserving only the environment needed for tracing and the AMI image
  # cache metadata.
  sudo --preserve-env=AWS_REGION,USER_DATA_EXTRA,ALPINE_RUNNER_TAG,ALPINE_AMI_BAZEL_CACHE_KEY_PATH -Hu runner /home/runner/run.sh || exit 2

  # Mirror the legacy provider's log line so downstream debugging still has the
  # same job-completion breadcrumb in CloudWatch.
  STATUS=$(grep -Phors "finish job request for job [0-9a-f\\-]+ with result: \\K.*" /home/runner/_diag/ | tail -n1)
  [ -n "$STATUS" ] && echo CDKGHA JOB DONE "$label" "$STATUS"
}
if setup_logs && setup_runtime_env && action | tee /var/log/runner.log 2>&1; then
  aws stepfunctions send-task-success --task-token "$TASK_TOKEN" --task-output '{"ok": true}'
else
  aws stepfunctions send-task-failure --task-token "$TASK_TOKEN"
fi
sleep 10
poweroff
`
        .replace(/{/g, "\\{")
        .replace(/}/g, "\\}")
        .replace(/\\{\\}/g, "{}");
}
/* eslint-enable cyberworlds/string-quotes */

export class AwsGithubRunnerAsgProvider extends Construct implements IRunnerProvider {
    public readonly labels: Array<string>;
    public readonly logGroup: ILogGroup;
    public readonly retryableErrors: Array<string> = ["Ec2.Ec2Exception", "States.Timeout"];

    private readonly runnerLaunchTemplateId: string;
    private readonly runnerRole: Role;
    private readonly runnerSecurityGroup: SecurityGroup;
    private readonly subnets: Array<{subnetId: string}>;
    private readonly userDataTemplate: string;
    private readonly userDataExtraBase64: string;
    private readonly amiBazelCacheKeyParameter: StringParameter;
    private readonly amiSourceBundleBucket: Bucket;
    private readonly amiSourceBundleKeyParameter: StringParameter;

    constructor(
        scope: Construct,
        id: string,
        {
            label,
            vpc,
            userDataExtra,
        }: {
            label: string;
            vpc: IVpc;
            userDataExtra: string;
        },
    ) {
        super(scope, id);

        this.labels = [label];
        this.subnets = vpc.selectSubnets({subnetType: SubnetType.PUBLIC}).subnets;
        const amiSourceBundleBucketName = `cyberworlds-github-runner-source-bundle`;

        this.runnerRole = new Role(this, "RunnerRole", {
            assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
                ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
            ],
        });
        this.runnerRole.addToPrincipalPolicy(
            new PolicyStatement({
                actions: [
                    "states:SendTaskFailure",
                    "states:SendTaskHeartbeat",
                    "states:SendTaskSuccess",
                ],
                resources: ["*"],
                conditions: {
                    StringEquals: {
                        "aws:ResourceTag/aws:cloudformation:stack-id": Stack.of(this).stackId,
                    },
                },
            }),
        );

        this.logGroup = new LogGroup(this, "RunnerLogGroup", {retention: RetentionDays.ONE_MONTH});
        this.logGroup.grantWrite(this);

        this.runnerSecurityGroup = new SecurityGroup(this, "RunnerSecurityGroup", {
            vpc,
            allowAllOutbound: true,
        });

        this.amiSourceBundleBucket = new Bucket(this, "AmiSourceBundleBucket", {
            bucketName: amiSourceBundleBucketName,
            encryption: BucketEncryption.S3_MANAGED,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            lifecycleRules: [{expiration: Duration.days(14)}],
        });
        this.amiSourceBundleKeyParameter = new StringParameter(
            this,
            "AmiSourceBundleKeyParameter",
            {
                parameterName: awsGithubRunnerAmiSourceBundleKeyParameterName,
                stringValue: "uninitialized",
            },
        );
        this.amiBazelCacheKeyParameter = new StringParameter(this, "AmiBazelCacheKeyParameter", {
            parameterName: awsGithubRunnerAmiBazelCacheKeyParameterName,
            stringValue: "uninitialized",
        });

        const runnerImageBuilder = Ec2RunnerProvider.imageBuilder(this, "RunnerImageBuilder", {
            vpc,
            subnetSelection: {subnetType: SubnetType.PUBLIC},
            os: Os.LINUX_UBUNTU,
            architecture: Architecture.ARM64,
            baseAmi: Stack.of(this).formatArn({
                service: "imagebuilder",
                resource: "image",
                account: "aws",
                resourceName: "ubuntu-server-24-lts-arm64/x.x.x",
            }),
            awsImageBuilderOptions: {
                // The AMI build runs `bazel fetch //...` and `build //:node_modules`. Give it a
                // runner-sized box so weekly/main image refreshes spend their time warming the
                // cache rather than waiting on a tiny builder.
                instanceType: InstanceType.of(InstanceClass.M7G, InstanceSize.XLARGE2),
            },
            components: awsGithubTestRunnerImageBuilderComponents([], {
                amiSourceBundleBucketName,
                amiSourceBundleKeyParameterName: this.amiSourceBundleKeyParameter.parameterName,
                bazelCacheKeyParameterName: this.amiBazelCacheKeyParameter.parameterName,
            }),
        });
        const runnerImageBuilderRole: unknown = (runnerImageBuilder as any).role;
        assert(runnerImageBuilderRole instanceof Role);
        this.amiSourceBundleBucket.grantRead(runnerImageBuilderRole);
        this.amiSourceBundleKeyParameter.grantRead(runnerImageBuilderRole);
        this.amiBazelCacheKeyParameter.grantRead(runnerImageBuilderRole);

        const runnerAmi = runnerImageBuilder.bindAmi();

        // HACK: CloudSnorkel doesn't expose Image Builder volume mappings. Reach into its
        // generated recipe to size the build root volume.
        assert(runnerImageBuilder instanceof Construct);
        const runnerImageBuilderAmiRecipe = runnerImageBuilder.node
            .findChild("Ami Recipe")
            .node.findChild("Recipe");

        assert(runnerImageBuilderAmiRecipe instanceof CfnImageRecipe);
        runnerImageBuilderAmiRecipe.blockDeviceMappings = [
            {
                deviceName: "/dev/sda1",
                ebs: {
                    deleteOnTermination: true,
                    volumeSize: awsGithubRunnerAmiRootVolumeSizeGib,
                    volumeType: "gp3",
                },
            },
        ];

        assert(
            runnerAmi.architecture.instanceTypeMatch(
                InstanceType.of(InstanceClass.M7G, InstanceSize.XLARGE2),
            ),
        );
        this.runnerLaunchTemplateId = assertExists(runnerAmi.launchTemplate.launchTemplateId);
        this.userDataTemplate = createLinuxUserDataTemplate();
        this.userDataExtraBase64 = Fn.base64(userDataExtra);
    }

    public get connections() {
        return this.runnerSecurityGroup.connections;
    }

    public get grantPrincipal() {
        return this.runnerRole.grantPrincipal;
    }

    public grantAmiRefreshWorkflow(grantee: IGrantable) {
        this.amiSourceBundleBucket.grantReadWrite(grantee);
        this.amiSourceBundleKeyParameter.grantRead(grantee);
        this.amiSourceBundleKeyParameter.grantWrite(grantee);
        this.amiBazelCacheKeyParameter.grantRead(grantee);
        this.amiBazelCacheKeyParameter.grantWrite(grantee);
        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: [
                    "imagebuilder:GetImage",
                    "imagebuilder:ListImagePipelines",
                    "imagebuilder:StartImagePipelineExecution",
                ],
                resources: ["*"],
            }),
        );
    }

    public getStepFunctionTask(parameters: RunnerRuntimeParameters): IChainable {
        const instanceProfile = new CfnInstanceProfile(this, "RunnerInstanceProfile", {
            roles: [this.runnerRole.roleName],
        });
        assert(this.subnets.length > 0);

        const subnets = this.subnets.map((subnet, index) => {
            return new CallAwsService(this, `RunRunnerInSubnet${index + 1}`, {
                comment: subnet.subnetId,
                service: "ec2",
                action: "runInstances",
                integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
                heartbeatTimeout: Timeout.duration(awsGithubRunnerHeartbeatTimeout),
                taskTimeout: Timeout.duration(awsGithubRunnerTaskTimeout),
                parameters: {
                    LaunchTemplate: {
                        LaunchTemplateId: this.runnerLaunchTemplateId,
                    },
                    MinCount: 1,
                    MaxCount: 1,
                    InstanceType: InstanceType.of(
                        InstanceClass.M7G,
                        InstanceSize.XLARGE2,
                    ).toString(),
                    UserData: JsonPath.base64Encode(
                        JsonPath.format(
                            this.userDataTemplate,
                            JsonPath.taskToken,
                            this.logGroup.logGroupName,
                            parameters.runnerNamePath,
                            parameters.runnerTokenPath,
                            parameters.registrationUrl,
                            this.labels.join(","),
                            this.userDataExtraBase64,
                        ),
                    ),
                    InstanceInitiatedShutdownBehavior: "terminate",
                    IamInstanceProfile: {
                        Arn: instanceProfile.attrArn,
                    },
                    MetadataOptions: {
                        HttpTokens: "required",
                    },
                    SecurityGroupIds: [this.runnerSecurityGroup.securityGroupId],
                    SubnetId: subnet.subnetId,
                    BlockDeviceMappings: [
                        {
                            DeviceName: "/dev/sda1",
                            Ebs: {
                                DeleteOnTermination: true,
                                VolumeSize: awsGithubRunnerAmiRootVolumeSizeGib,
                                VolumeType: "gp3",
                            },
                        },
                    ],
                    TagSpecifications: [
                        {
                            ResourceType: "instance",
                            Tags: [
                                {
                                    Key: "CloudWatchAgent",
                                    Value: "true",
                                },
                                {
                                    Key: "GitHubRunners:Provider",
                                    Value: this.node.path,
                                },
                            ],
                        },
                        {
                            ResourceType: "volume",
                            Tags: [
                                {
                                    Key: "GitHubRunners:Provider",
                                    Value: this.node.path,
                                },
                            ],
                        },
                    ],
                },
                iamResources: ["*"],
            });
        });

        for (let index = 1; index < subnets.length; index += 1) {
            assertExists(subnets[index - 1]).addCatch(assertExists(subnets[index]), {
                errors: this.retryableErrors,
                resultPath: JsonPath.stringAt("$.lastSubnetError"),
            });
        }

        return assertExists(subnets[0]);
    }

    public grantStateMachine(stateMachineRole: IGrantable): void {
        stateMachineRole.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["iam:PassRole"],
                resources: [this.runnerRole.roleArn],
                conditions: {
                    StringEquals: {
                        "iam:PassedToService": "ec2.amazonaws.com",
                    },
                },
            }),
        );
        stateMachineRole.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["ec2:createTags"],
                resources: [
                    Stack.of(this).formatArn({
                        service: "ec2",
                        resource: "*",
                    }),
                ],
            }),
        );
    }

    public status(statusFunctionRole: IGrantable): IRunnerProviderStatus {
        statusFunctionRole.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["ec2:DescribeLaunchTemplateVersions"],
                resources: ["*"],
            }),
        );
        return {
            type: "AwsGithubRunnerAsgProvider",
            labels: this.labels,
            roleArn: this.runnerRole.roleArn,
            securityGroups: [this.runnerSecurityGroup.securityGroupId],
            ami: {launchTemplate: this.runnerLaunchTemplateId},
            logGroup: this.logGroup.logGroupName,
        };
    }
}
