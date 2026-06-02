import {
    Architecture,
    Ec2RunnerProvider,
    IRunnerProvider,
    IRunnerProviderStatus,
    Os,
    RunnerRuntimeParameters,
} from "@cloudsnorkel/cdk-github-runners";
import {Duration, Fn, Stack} from "aws-cdk-lib";
import {
    IVpc,
    InstanceClass,
    InstanceSize,
    InstanceType,
    Port,
    SecurityGroup,
    SubnetType,
} from "aws-cdk-lib/aws-ec2";
import {FileSystem, PerformanceMode, ThroughputMode} from "aws-cdk-lib/aws-efs";
import {
    CfnInstanceProfile,
    IGrantable,
    ManagedPolicy,
    PolicyStatement,
    Role,
    ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {ILogGroup, LogGroup, RetentionDays} from "aws-cdk-lib/aws-logs";
import {IChainable, IntegrationPattern, JsonPath, Timeout} from "aws-cdk-lib/aws-stepfunctions";
import {CallAwsService} from "aws-cdk-lib/aws-stepfunctions-tasks";
import {Construct} from "constructs";
import {awsGithubTestRunnerImageBuilderComponents} from "~/admin/aws/internal/aws_github_test_runner_image_builder_components.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const awsGithubRunnerTaskTimeout = Duration.hours(6);
const awsGithubRunnerHeartbeatTimeout = Duration.minutes(10);

/* eslint-disable cyberworlds/string-quotes */
function createLinuxUserDataTemplate() {
    return `#!/bin/bash -x
TASK_TOKEN="{}"
logGroupName="{}"
runnerNamePath="{}"
runnerTokenPath="{}"
registrationURL="{}"
cacheFileSystemDnsName="{}"
label="{}"
export USER_DATA_EXTRA="$(echo "{}" | base64 --decode)"
export ALPINE_RUNNER_TAG="$label"

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
mount_cache () {
  # Resolve the region from IMDS so the bootstrap can use the instance role for
  # both Step Functions callbacks and the shared Bazel cache setup.
  metadata_token=$(curl -sS -X PUT http://169.254.169.254/latest/api/token \
    -H 'x-aws-ec2-metadata-token-ttl-seconds: 21600')
  export AWS_REGION=$(curl -sS -H "x-aws-ec2-metadata-token: $metadata_token" \
    http://169.254.169.254/latest/dynamic/instance-identity/document | \
    node -e 'let data="";process.stdin.on("data",chunk=>data+=chunk);process.stdin.on("end",()=>process.stdout.write(JSON.parse(data).region));')

  # Mount the shared EFS-backed Bazel cache and expose it through the same
  # path the workflow-level cache initialization action expects.
  #
  # This is intentionally **not** a strong workload-isolation boundary: jobs on
  # different instances can observe and mutate data on the same filesystem. Any
  # future copy of this pattern should treat those runners as trust-equivalent,
  # not as fully isolated tenants with independent authz boundaries.
  mkdir -p /mnt/bazel-cache
  mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport "$cacheFileSystemDnsName":/ /mnt/bazel-cache
  mkdir -p /mnt/bazel-cache/cache-root
  chown runner:runner /mnt/bazel-cache/cache-root
  export GITHUB_RUNNER_SHARED_BAZEL_CACHE_DIR=/mnt/bazel-cache/cache-root
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
  # preserving only the environment needed for cache access and tracing.
  sudo --preserve-env=AWS_REGION,GITHUB_RUNNER_SHARED_BAZEL_CACHE_DIR,USER_DATA_EXTRA,ALPINE_RUNNER_TAG -Hu runner /home/runner/run.sh || exit 2

  # Mirror the legacy provider's log line so downstream debugging still has the
  # same job-completion breadcrumb in CloudWatch.
  STATUS=$(grep -Phors "finish job request for job [0-9a-f\\-]+ with result: \\K.*" /home/runner/_diag/ | tail -n1)
  [ -n "$STATUS" ] && echo CDKGHA JOB DONE "$label" "$STATUS"
}
if setup_logs && mount_cache && action | tee /var/log/runner.log 2>&1; then
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

    private readonly cacheFileSystemDnsName: string;
    private readonly runnerLaunchTemplateId: string;
    private readonly runnerRole: Role;
    private readonly runnerSecurityGroup: SecurityGroup;
    private readonly subnets: Array<{subnetId: string}>;
    private readonly userDataTemplate: string;
    private readonly userDataExtraBase64: string;

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

        const cacheFileSystemSecurityGroup = new SecurityGroup(
            this,
            "CacheFileSystemSecurityGroup",
            {
                vpc,
                allowAllOutbound: true,
            },
        );
        cacheFileSystemSecurityGroup.addIngressRule(
            this.runnerSecurityGroup,
            Port.tcp(2049),
            "Allow runners to mount the shared Bazel cache",
        );

        const cacheFileSystem = new FileSystem(this, "CacheFileSystem", {
            vpc,
            securityGroup: cacheFileSystemSecurityGroup,
            vpcSubnets: {subnetType: SubnetType.PUBLIC},
            performanceMode: PerformanceMode.GENERAL_PURPOSE,
            throughputMode: ThroughputMode.ELASTIC,
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
                instanceType: InstanceType.of(InstanceClass.M7G, InstanceSize.MEDIUM),
            },
            components: awsGithubTestRunnerImageBuilderComponents(["nfs-common", "rsync"]),
        });

        const runnerAmi = runnerImageBuilder.bindAmi();
        assert(
            runnerAmi.architecture.instanceTypeMatch(
                InstanceType.of(InstanceClass.M7G, InstanceSize.XLARGE2),
            ),
        );
        this.runnerLaunchTemplateId = assertExists(runnerAmi.launchTemplate.launchTemplateId);
        this.cacheFileSystemDnsName = `${cacheFileSystem.fileSystemId}.efs.${Stack.of(this).region}.amazonaws.com`;
        this.userDataTemplate = createLinuxUserDataTemplate();
        this.userDataExtraBase64 = Fn.base64(userDataExtra);
    }

    public get connections() {
        return this.runnerSecurityGroup.connections;
    }

    public get grantPrincipal() {
        return this.runnerRole.grantPrincipal;
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
                            this.cacheFileSystemDnsName,
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
                                VolumeSize: 80,
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
