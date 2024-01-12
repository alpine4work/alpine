import {Duration} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {InstanceType, Port, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    AsgCapacityProvider,
    ContainerImage,
    Ec2Service,
    Ec2TaskDefinition,
    EcsOptimizedImage,
    Secret as EcsSecret,
    NetworkMode,
} from "aws-cdk-lib/aws-ecs";
import {ManagedPolicy, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

export class AwsJobQueueService extends Construct {
    constructor(
        parentConstruct: Construct,
        {
            vpc,
            ecsCluster,
            dynamo,
            opensearch,
            sqs,
            taskRealtimeService,
        }: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            dynamo: AwsDynamo;
            opensearch: AwsOpensearch;
            sqs: AwsSqs;
            taskRealtimeService: AwsTaskRealtimeService;
        },
    ) {
        super(parentConstruct, "JobQueueService");

        const autoScalingGroup = new AutoScalingGroup(this, "AutoScalingGroup", {
            vpc,
            // First 750 hours per month of this instance type are free. That effectively
            // translates to 1 free capacity of this instance type across our AWS account.
            instanceType: new InstanceType("t3.micro"),
            machineImage: EcsOptimizedImage.amazonLinux2(),

            minCapacity: 1,
            // During a deploy, we double our capacity needs since we keep running old
            // instances to maintain availability while a new fleet of instances start.
            maxCapacity: 2,

            // See the long comment in `AwsAppService` for why we use a public
            // subnet for our services. The TL;DR is sending egress traffic like Honeycomb
            // API calls through a NAT gateway can get expensive.
            vpcSubnets: {subnetType: SubnetType.PUBLIC},
        });

        // Add the ability to connect to our EC2 instances with Session Manager.
        // https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html
        autoScalingGroup.role.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        );

        // OpenSearch is in our private VPC subnet. Allow connections from our
        // EC2 instances.
        opensearch.allowConnectionsFrom(autoScalingGroup);

        // Allow `JobQueueService` to connect to any `TaskRealtimeService` port.
        taskRealtimeService.autoScalingGroup.connections.allowFrom(autoScalingGroup, Port.allTcp());

        const autoScalingGroupCapacityProvider = new AsgCapacityProvider(
            this,
            "AutoScalingGroupCapacityProvider",
            {autoScalingGroup},
        );

        ecsCluster.cluster.addAsgCapacityProvider(autoScalingGroupCapacityProvider);

        const secrets = Secret.fromSecretNameV2(this, "SecretsImport", "JobQueueServiceSecrets");

        const taskDefinition = new Ec2TaskDefinition(this, "TaskDefinition", {
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

        taskDefinition.addContainer("Container", {
            image: ContainerImage.fromTarball(
                joinPath(
                    runfilesPath,
                    "cyberworlds/server/jobs/queue/queue_image_tarball/tarball.tar",
                ),
            ),
            // This appears to be the available memory for our containers. Unclear how we
            // get this number from 1024 (the instance type's memory). It makes sense that
            // we'd need some overhead for ECS.
            memoryLimitMiB: 944,
            // Send logs to AWS. Container logs are short-lived and used for debugging
            // obscure machine-level issues. Our long-lived logs are in Honeycomb.
            logging: ecsCluster.shortLivedLogDriver,
            // Increase stop timeout to five minutes so essential background processes have
            // ample time to finish. For example, task action indexing which is done in the
            // background with `context.process.waitUntil()`.
            stopTimeout: Duration.minutes(5),
            // For security, use the `www-data` user which exists on our Linux image. It
            // only has read access and execute access to files on our system.
            user: "www-data",
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
                JOB_QUEUE_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "jobQueueServicePublicKey",
                ),
                JOB_QUEUE_SERVICE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "jobQueueServicePrivateKey",
                ),
                HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
                COHERE_API_KEY: EcsSecret.fromSecretsManager(secrets, "cohereApiKey"),
            },
            environment: {
                NODE_ENV: "production",
            },
            command: [
                // Running using a shell so variables like `$HONEYCOMB_API_KEY` expand to the
                // proper value.
                "sh",
                "-c",
                `/var/www/server/jobs/queue/queue ${[
                    `--opensearchHost=${opensearch.opensearchHost}`,
                    `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                    `--ecsCluster=${ecsCluster.cluster.clusterName}`,
                    `--taskRealtimeServiceEcsTaskDefinitionFamily=${taskRealtimeService.taskDefinition.family}`,
                    "--honeycombApiKey=$HONEYCOMB_API_KEY",
                    "--cohereApiKey=$COHERE_API_KEY",
                    // Intentionally escape `$` here! Our key args accept either a file path
                    // or the name of an environment variable. RSA keys are too long to be included
                    // in a command line string and are hard to quote so we lookup the environment
                    // variable within the program.
                    "--appServicePublicKey=\\$APP_SERVICE_PUBLIC_KEY",
                    "--edgeServiceFamilyPublicKey=\\$EDGE_SERVICE_FAMILY_PUBLIC_KEY",
                    "--taskRealtimeServicePublicKey=\\$TASK_REALTIME_SERVICE_PUBLIC_KEY",
                    "--jobQueueServicePublicKey=\\$JOB_QUEUE_SERVICE_PUBLIC_KEY",
                    "--servicePrivateKey=\\$JOB_QUEUE_SERVICE_PRIVATE_KEY",
                ].join(" ")}`,
            ],
            healthCheck: {
                command: [
                    "CMD-SHELL",
                    // `curl` is not installed in container. Use a script with our Node.js binary to
                    // perform healthcheck.
                    `/var/www/server/jobs/queue/queue.runfiles/node_linux_amd64/bin/nodejs/bin/node --input-type module --eval "import fs from 'fs'; if (fs.readFileSync('/var/www-data/server_jobs_queue_healthcheck.txt', 'utf8').trim() !== 'Healthy') { throw new Error('Healthcheck failed') }"`,
                ],
            },
        });

        dynamo.grantReadWriteData(taskDefinition.taskRole);
        opensearch.grantReadWriteData(taskDefinition.taskRole);
        sqs.grantSendAndReceiveJobQueueMessages(taskDefinition.taskRole);

        // `JobQueueService` needs to check what tasks ECS is running to appropriately
        // route task requests to the right `TaskRealtimeService`.
        taskDefinition.addToTaskRolePolicy(
            new PolicyStatement({
                actions: [
                    "ecs:ListTasks",
                    "ecs:DescribeTasks",
                    "ecs:DescribeContainerInstances",
                    "ec2:DescribeNetworkInterfaces",
                ],
                resources: ["*"],
            }),
        );

        const service = new Ec2Service(this, "Service", {
            cluster: ecsCluster.cluster,
            taskDefinition,
            desiredCount: 1,
            // Specifies the max/min task count during a deploy.
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            capacityProviderStrategies: [
                {
                    capacityProvider: autoScalingGroupCapacityProvider.capacityProviderName,
                    weight: 1,
                },
            ],
        });

        opensearch.allowConnectionsFrom(service.connections);
    }
}
