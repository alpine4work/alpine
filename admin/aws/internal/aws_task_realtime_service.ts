import {Duration} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {
    InstanceSize,
    InstanceType,
    Peer,
    Port,
    SecurityGroup,
    SubnetType,
    Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
    AmiHardwareType,
    AsgCapacityProvider,
    ContainerImage,
    Ec2Service,
    Ec2TaskDefinition,
    EcsOptimizedImage,
    Secret as EcsSecret,
    NetworkMode,
    TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import {ManagedPolicy} from "aws-cdk-lib/aws-iam";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {awsServiceInstanceClass} from "~/admin/aws/internal/aws_service_instance_class.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {cloudflareIpV4s, cloudflareIpV6s} from "~/server/helpers/node/cloudflare_ips.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {taskRealtimeServiceDiscoveryWaitMs} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export class AwsTaskRealtimeService extends Construct {
    public readonly autoScalingGroup: AutoScalingGroup;
    public readonly securityGroup: SecurityGroup;
    public readonly taskDefinition: TaskDefinition;

    constructor(
        parentConstruct: Construct,
        {
            vpc,
            ecsCluster,
            dynamo,
            opensearch,
            sqs,
        }: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            dynamo: AwsDynamo;
            opensearch: AwsOpensearch;
            sqs: AwsSqs;
        },
    ) {
        super(parentConstruct, "TaskRealtimeService");

        // `TaskRealtimeService` is a stateful service. Each `TaskRealtimeService`
        // manages realtime connections for one or more spaces. Spaces are routed
        // evenly between `TaskRealtimeService` partitions. So multiple users from the
        // same space consistently go to the same `TaskRealtimeService` instance.
        //
        // To horizontally scale `TaskRealtimeService` you have two options:
        //
        // 1. Increase the number of partitions
        // 2. Increase the number of instances per partition
        //
        // `SpaceId`s are evenly routed across partitions. If an instance is getting
        // overwhelmed by needing to handle too many spaces, add more partitions. If an
        // instance is getting overwhelmed by too many connections from the same space
        // then increase the number of instances per partition so there are multiple
        // copies of a space's data to handle load.
        //
        // The number of instances per partition should probably be somewhat low
        // (e.g. 1, 2, or 3). There are inefficiencies to having multiple
        // `TaskRealtimeService` instances keeping a copy of the same space's data.
        // Namely you decrease your chance of cache hits. Generally your tool for
        // scaling `TaskRealtimeService` should be increasing the number of partitions.
        const partitionCount = 2;
        const partitionInstanceCount = 1;

        // First 750 hours per month of the `t3.micro` instance type are free. That
        // effectively translates to 1 free capacity of this instance type across our
        // AWS account.
        //
        // IMPORTANT: We need to know the number of CPUs on our instance
        // (`instanceCpuCount`). If you change the instance type you should also change
        // `instanceCpuCount` to the correct number of vCPUs according to:
        // https://aws.amazon.com/ec2/instance-types/
        const instanceType = InstanceType.of(awsServiceInstanceClass, InstanceSize.MICRO);
        const instanceCpuCount = 2;

        this.autoScalingGroup = new AutoScalingGroup(this, "AutoScalingGroup", {
            vpc,
            instanceType,
            machineImage: EcsOptimizedImage.amazonLinux2(AmiHardwareType.ARM),

            minCapacity: partitionCount * partitionInstanceCount,
            // During a deploy, we double our capacity needs since we keep running old
            // instances to maintain availability while a new fleet of instances start.
            maxCapacity: partitionCount * partitionInstanceCount * 2,

            // See the long comment in `AwsAppService` for why we use a public
            // subnet for our services. The TL;DR is sending egress traffic like Honeycomb
            // API calls through a NAT gateway can get expensive.
            //
            // Additionally, `TaskRealtimeService` needs to be connected to the public
            // internet since we need to establish WebSocket connections to it. Well,
            // specifically Cloudflare needs to establish a WebSocket connection. All
            // WebSocket traffic should be proxied through Cloudflare. We don't expect
            // client devices to connect directly to our `TaskRealtimeService` AWS servers.
            vpcSubnets: {subnetType: SubnetType.PUBLIC},
        });

        this.securityGroup = assertExists(
            // @ts-expect-error: The `securityGroup` property is private but we need to use
            // it. We could construct our own `SecurityGroup` and pass it into
            // `new AutoScalingGroup()` but that would delete the existing `SecurityGroup`
            // which is probably fine but would rather not risk it.
            //
            // https://github.com/aws/aws-cdk/blob/a0289271aa9990f85c120d0549b878bd3c6ea484/packages/aws-cdk-lib/aws-autoscaling/lib/auto-scaling-group.ts#L1337
            this.autoScalingGroup.securityGroup,
        );

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        this.autoScalingGroup.role.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        opensearch.allowConnectionsFrom(this.autoScalingGroup);

        // Allow Cloudflare to access `TaskRealtimeService` port 80 from the public
        // internet. No one else on the public internet should be able to access
        // `TaskRealtimeService` instances directly.
        {
            for (const cloudflareIpV4 of cloudflareIpV4s) {
                this.autoScalingGroup.connections.allowFrom(
                    Peer.ipv4(cloudflareIpV4),
                    Port.tcp(80),
                    "Cloudflare",
                );
            }
            for (const cloudflareIpV6 of cloudflareIpV6s) {
                this.autoScalingGroup.connections.allowFrom(
                    Peer.ipv6(cloudflareIpV6),
                    Port.tcp(80),
                    "Cloudflare",
                );
            }
        }

        const autoScalingGroupCapacityProvider = new AsgCapacityProvider(
            this,
            "AutoScalingGroupCapacityProvider",
            {autoScalingGroup: this.autoScalingGroup},
        );

        ecsCluster.cluster.addAsgCapacityProvider(autoScalingGroupCapacityProvider);

        const portBase = 4000;
        const secrets = Secret.fromSecretNameV2(
            this,
            "SecretsImport",
            "TaskRealtimeServiceSecrets",
        );

        this.taskDefinition = new Ec2TaskDefinition(this, "TaskDefinition", {
            // According to the docs:
            //
            // > The host and awsvpc network modes offer the highest networking performance
            // > for containers because they use the Amazon EC2 network stack.
            //
            // Also:
            //
            // > Important: When running tasks that use the host network mode, do not run
            // > containers using the root user (UID 0) for better security.
            //
            // We use the host network mode for performance. We're running on public VPC
            // subnets so that means anyone on the internet can send a request to our
            // instance.
            //
            // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
            networkMode: NetworkMode.HOST,
        });

        const ports = createArrayWithLength(instanceCpuCount, index => portBase + index + 1);

        const cpu = 2048;

        // Memory available to our container. We can't use the full available memory
        // (1024 MiB for `t4g.micro` instances) because the ECS agent needs some memory
        // to function.
        //
        // The right value is available on the container instance screen in the AWS
        // console. Specifically under the "Resources & networking" tab. You want to
        // look at "Total capacity" and make sure we're reserving all of it.
        //
        // NOTE(calebmer, 2024-11-25): I've observed that if you reserve too much
        // memory on `t4g.nano` instances you don't get an error. Instead the tasks are
        // stuck in the "Provisioning" status forever.
        const memoryLimitMiB = 936;

        const gatewayResourcePercent = 0.02;

        this.taskDefinition.addContainer("Container", {
            image: ContainerImage.fromTarball(
                joinPath(
                    runfilesPath,
                    process.env.CDK_LITE === "true"
                        ? "cyberworlds/admin/aws/empty_image_tarball_load/tarball.tar"
                        : "cyberworlds/server/tasks/realtime/realtime_image_tarball_load/tarball.tar",
                ),
            ),
            cpu: cpu - Math.floor(cpu * gatewayResourcePercent),
            memoryReservationMiB:
                memoryLimitMiB - Math.floor(memoryLimitMiB * gatewayResourcePercent),
            // Send logs to AWS. Container logs are short-lived and used for debugging
            // obscure machine-level issues. Our long-lived logs are in Honeycomb.
            logging: ecsCluster.shortLivedLogDriver,
            // Increase stop timeout to two minutes so essential background processes
            // have ample time to finish. For example, task action indexing which is done
            // in the background with `context.process.waitUntil()`.
            stopTimeout: Duration.minutes(2),
            // For security, use the `www-data` user which exists on our Linux image. It
            // only has read access and execute access to files on our system.
            user: "www-data",
            // `TaskRealtimeService` spawns a worker for each CPU on the instance type.
            // Each of these workers expose their own HTTP server for us to connect to.
            portMappings: ports.map(port => ({
                containerPort: port,
                hostPort: port,
            })),
            secrets: {
                APP_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "appServicePublicKey",
                ),
                EDGE_SERVICE_FAMILY_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "edgeServiceFamilyPublicKey",
                ),
                TASK_REALTIME_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "taskRealtimeServicePublicKey",
                ),
                TASK_REALTIME_SERVICE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "taskRealtimeServicePrivateKey",
                ),
                JOB_QUEUE_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "jobQueueServicePublicKey",
                ),
                FILE_PROCESSOR_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "fileProcessorServicePublicKey",
                ),
                API_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "apiServicePublicKey",
                ),
                RESOURCE_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "resourceServicePublicKey",
                ),
                TOKEN_AGENT_SECRET: EcsSecret.fromSecretsManager(secrets, "tokenAgentSecret"),
                HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
            },
            environment: {
                BAZEL_BINDIR: ".",
                NODE_ENV: "production",
            },
            command: [
                // NOTE(calebmer): We're not using a shell (e.g. `sh -c`) here because it
                // breaks ECS process termination. The `SIGTERM` signal is sent to the shell
                // (e.g. `sh -c`) not our process.
                //
                // `runProcess()` implements env variable substitution which is why we can use
                // env variable syntax like `$HONEYCOMB_API_KEY`.
                `/var/www/server/tasks/realtime/realtime ${[
                    `--portBase=${portBase}`,
                    `--opensearchDomainEndpoint=${opensearch.domainEndpoint}`,
                    "--edgeServiceUrl=https://alpine.inc",
                    "--resourceServiceUrl=https://resources.alpine.inc",
                    `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                    `--fileProcessorJobQueueUrl=${sqs.getFileProcessorJobQueueUrl()}`,
                    `--fileProcessorHeavyJobQueueUrl=${sqs.getFileProcessorHeavyJobQueueUrl()}`,
                    `--fileProcessorLightJobQueueUrl=${sqs.getFileProcessorLightJobQueueUrl()}`,
                    "--honeycombApiKey=$HONEYCOMB_API_KEY",
                    "--appServicePublicKey=$APP_SERVICE_PUBLIC_KEY",
                    "--edgeServiceFamilyPublicKey=$EDGE_SERVICE_FAMILY_PUBLIC_KEY",
                    "--taskRealtimeServicePublicKey=$TASK_REALTIME_SERVICE_PUBLIC_KEY",
                    "--resourceServicePublicKey=$RESOURCE_SERVICE_PUBLIC_KEY",
                    "--jobQueueServicePublicKey=$JOB_QUEUE_SERVICE_PUBLIC_KEY",
                    "--fileProcessorServicePublicKey=$FILE_PROCESSOR_SERVICE_PUBLIC_KEY",
                    "--apiServicePublicKey=$API_SERVICE_PUBLIC_KEY",
                    "--servicePrivateKey=$TASK_REALTIME_SERVICE_PRIVATE_KEY",
                    "--tokenAgentSecret=$TOKEN_AGENT_SECRET",
                ].join(" ")}`,
            ],
            healthCheck: {
                // `TaskRealtimeService` won't be healthy for 4 minutes! (The
                // `TaskRealtimeServiceRouterBase` invalidation timeout.) That's because we
                // need to wait for `TaskRealtimeService` to be discovered by all our peers.
                startPeriod: Duration.millis(taskRealtimeServiceDiscoveryWaitMs),

                /* eslint-disable string-quotes */

                command: [
                    "CMD-SHELL",
                    // `curl` is not installed in container. Use a script with our Node.js binary to
                    // perform healthcheck.
                    `/var/www/server/tasks/realtime/realtime.runfiles/nodejs_linux_arm64/bin/nodejs/bin/node --input-type module --eval "${ports
                        .map(
                            port =>
                                `{ const response = await fetch('http://localhost:${port}/healthcheck'); if (!response.ok) { throw new Error('Healthcheck failed') } }`,
                        )
                        .join(" ")}"`,
                ],

                /* eslint-enable string-quotes */
            },
        });

        this.taskDefinition.addContainer("GatewayContainer", {
            image: ContainerImage.fromTarball(
                joinPath(
                    runfilesPath,
                    process.env.CDK_LITE === "true"
                        ? "cyberworlds/admin/aws/empty_image_tarball_load/tarball.tar"
                        : "cyberworlds/server/tasks/realtime/gateway/gateway_image_tarball_load/tarball.tar",
                ),
            ),
            cpu: Math.floor(cpu * gatewayResourcePercent),
            memoryReservationMiB: Math.floor(memoryLimitMiB * gatewayResourcePercent),
            // Send logs to AWS. Container logs are short-lived and used for debugging
            // obscure machine-level issues. Our long-lived logs are in Honeycomb.
            logging: ecsCluster.shortLivedLogDriver,
            // DANGER: We need to run as root to listen on port 80. The process immediately
            // downgrades to the `www-data` user once we've bound to port 80. We could put
            // the gateway server in the main `TaskRealtimeService` container but we decide
            // to use a sidecar container to limit the potential damage of root access.
            user: "root",
            portMappings: [{containerPort: 80, hostPort: 80}],
            environment: {
                NODE_ENV: "production",
            },
            command: [
                "/var/www/server/tasks/realtime/gateway/gateway",
                ...ports.map(port => `--port=${port}`),
            ],
            healthCheck: {
                command: [
                    "CMD-SHELL",
                    // `curl` is not installed in container. Use a script with our Node.js binary to
                    // perform healthcheck.
                    //
                    // eslint-disable-next-line string-quotes
                    `/var/www/server/tasks/realtime/gateway/gateway.runfiles/nodejs_linux_arm64/bin/nodejs/bin/node --input-type module --eval "const response = await fetch('http://localhost:80/healthcheck'); if (!response.ok) { throw new Error('Healthcheck failed') }"`,
                ],
            },
        });

        dynamo.grantReadWriteData(this.taskDefinition.taskRole);
        opensearch.grantReadWriteData(this.taskDefinition.taskRole);
        sqs.grantSendJobQueueMessages(this.taskDefinition.taskRole);

        for (let partitionIndex = 0; partitionIndex < partitionCount; partitionIndex++) {
            new AwsTaskRealtimeServicePartition(this, {
                ecsCluster,
                taskDefinition: this.taskDefinition,
                capacityProvider: autoScalingGroupCapacityProvider,
                partitionIndex,
                partitionCount,
                partitionInstanceCount,
            });
        }
    }
}

class AwsTaskRealtimeServicePartition extends Construct {
    constructor(
        parentScope: Construct,
        {
            ecsCluster,
            taskDefinition,
            capacityProvider,
            partitionIndex,
            partitionCount,
            partitionInstanceCount,
        }: {
            ecsCluster: AwsEcsCluster;
            taskDefinition: TaskDefinition;
            capacityProvider: AsgCapacityProvider;
            partitionIndex: number;
            partitionCount: number;
            partitionInstanceCount: number;
        },
    ) {
        super(parentScope, `Partition${partitionIndex + 1}Of${partitionCount}`);

        new Ec2Service(this, "Service", {
            cluster: ecsCluster.cluster,
            taskDefinition,
            desiredCount: partitionInstanceCount,
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            capacityProviderStrategies: [
                {capacityProvider: capacityProvider.capacityProviderName, weight: 1},
            ],
            // We want ECS to tag our task realtime tasks with the cluster name and service
            // name. We need these tags at runtime to route requests to the correct
            // `TaskRealtimeService` instance.
            enableECSManagedTags: true,
            circuitBreaker: {
                enable: true,
                rollback: true,
            },
        });
    }
}
