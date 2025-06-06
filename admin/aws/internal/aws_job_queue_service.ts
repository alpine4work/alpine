import {ArnFormat, Duration, Stack} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {InstanceSize, InstanceType, Port, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    AmiHardwareType,
    AsgCapacityProvider,
    ContainerImage,
    Ec2Service,
    Ec2TaskDefinition,
    EcsOptimizedImage,
    Secret as EcsSecret,
    NetworkMode,
} from "aws-cdk-lib/aws-ecs";
import {Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {AwsOpensearch} from "~/admin/aws/internal/aws_opensearch.js";
import {awsServiceInstanceClass} from "~/admin/aws/internal/aws_service_instance_class.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsTaskRealtimeService} from "~/admin/aws/internal/aws_task_realtime_service.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

export class AwsJobQueueService extends Construct {
    constructor(
        parentConstruct: Construct,
        {
            vpc,
            ecsCluster,
            cloudflareAccountId,
            dynamo,
            opensearch,
            sqs,
            taskRealtimeService,
        }: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            cloudflareAccountId: string;
            dynamo: AwsDynamo;
            opensearch: AwsOpensearch;
            sqs: AwsSqs;
            taskRealtimeService: AwsTaskRealtimeService;
        },
    ) {
        super(parentConstruct, "JobQueueService");

        const stack = Stack.of(this);

        const autoScalingGroup = new AutoScalingGroup(this, "AutoScalingGroup", {
            vpc,
            // First 750 hours per month of this instance type are free. That effectively
            // translates to 1 free capacity of this instance type across our AWS account.
            instanceType: InstanceType.of(awsServiceInstanceClass, InstanceSize.MICRO),
            machineImage: EcsOptimizedImage.amazonLinux2(AmiHardwareType.ARM),

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

        const schedulerRole = new Role(this, "SchedulerRole", {
            assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
        });

        // Allow scheduling deploys with AWS EventBridge Scheduler. We need to allow
        // `iam:PassRole` in addition to `scheduler:CreateSchedule`. Since the
        // scheduler will need to use the role on execution.
        {
            sqs.grantSendJobQueueMessages(schedulerRole);

            taskDefinition.addToTaskRolePolicy(
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["scheduler:CreateSchedule"],
                    resources: [
                        stack.formatArn({
                            arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
                            service: "scheduler",
                            region: stack.region,
                            account: stack.account,
                            resource: "schedule",
                            resourceName: "default/ScheduleDeployMaintenanceJob",
                        }),
                    ],
                }),
            );

            taskDefinition.addToTaskRolePolicy(
                new PolicyStatement({
                    actions: ["iam:PassRole"],
                    resources: [schedulerRole.roleArn],
                }),
            );
        }

        taskDefinition.addContainer("Container", {
            image: ContainerImage.fromTarball(
                joinPath(
                    runfilesPath,
                    process.env.CDK_LITE === "true"
                        ? "cyberworlds/admin/aws/empty_image_tarball_load/tarball.tar"
                        : "cyberworlds/server/jobs/queue/queue_image_tarball_load/tarball.tar",
                ),
            ),
            cpu: 2048,
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
            memoryLimitMiB: 936,
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
                FILE_PROCESSOR_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "fileProcessorServicePublicKey",
                ),
                JOB_QUEUE_SERVICE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "jobQueueServicePrivateKey",
                ),
                TOKEN_AGENT_SECRET: EcsSecret.fromSecretsManager(secrets, "tokenAgentSecret"),
                HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
                COHERE_API_KEY: EcsSecret.fromSecretsManager(secrets, "cohereApiKey"),
                APNS_CERTIFICATE: EcsSecret.fromSecretsManager(secrets, "apnsCertificate"),
                APNS_CERTIFICATE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "apnsCertificatePrivateKey",
                ),
                GITHUB_APP_ID: EcsSecret.fromSecretsManager(secrets, "githubAppId"),
                GITHUB_APP_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "githubAppPrivateKey",
                ),
                GITHUB_APP_CLIENT_ID: EcsSecret.fromSecretsManager(secrets, "githubAppClientId"),
                GITHUB_APP_CLIENT_SECRET: EcsSecret.fromSecretsManager(
                    secrets,
                    "githubAppClientSecret",
                ),
                GITHUB_APP_INSTALLATION_ID: EcsSecret.fromSecretsManager(
                    secrets,
                    "githubAppInstallationId",
                ),
                CLOUDFLARE_R2_ACCESS_KEY_ID: EcsSecret.fromSecretsManager(
                    secrets,
                    "cloudflareR2AccessKeyId",
                ),
                CLOUDFLARE_R2_SECRET_ACCESS_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "cloudflareR2SecretAccessKey",
                ),
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
                    `--opensearchDomainEndpoint=${opensearch.domainEndpoint}`,
                    `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                    `--fileProcessorJobQueueUrl=${sqs.getFileProcessorJobQueueUrl()}`,
                    `--jobQueueArn=${sqs.getJobQueueArn()}`,
                    `--schedulerJobQueueRoleArn=${schedulerRole.roleArn}`,
                    "--edgeServiceUrl=https://alpine.inc",
                    `--ecsCluster=${ecsCluster.cluster.clusterName}`,
                    `--taskRealtimeServiceEcsTaskDefinitionFamily=${taskRealtimeService.taskDefinition.family}`,
                    `--taskRealtimeServiceSecurityGroupId=${taskRealtimeService.securityGroup.securityGroupId}`,
                    "--honeycombApiKey=$HONEYCOMB_API_KEY",
                    "--cohereApiKey=$COHERE_API_KEY",
                    "--githubAppId=$GITHUB_APP_ID",
                    "--githubAppClientId=$GITHUB_APP_CLIENT_ID",
                    "--githubAppClientSecret=$GITHUB_APP_CLIENT_SECRET",
                    "--githubAppInstallationId=$GITHUB_APP_INSTALLATION_ID",
                    `--cloudflareAccountId=${cloudflareAccountId}`,
                    `--cloudflareR2AccessKeyId=$CLOUDFLARE_R2_ACCESS_KEY_ID`,
                    `--cloudflareR2SecretAccessKey=$CLOUDFLARE_R2_SECRET_ACCESS_KEY`,
                    // Intentionally escape `$` here! Our key args accept either a file path
                    // or the name of an environment variable. RSA keys are too long to be included
                    // in a command line string and are hard to quote so we lookup the environment
                    // variable within the program.
                    "--appServicePublicKey=\\$APP_SERVICE_PUBLIC_KEY",
                    "--edgeServiceFamilyPublicKey=\\$EDGE_SERVICE_FAMILY_PUBLIC_KEY",
                    "--taskRealtimeServicePublicKey=\\$TASK_REALTIME_SERVICE_PUBLIC_KEY",
                    "--jobQueueServicePublicKey=\\$JOB_QUEUE_SERVICE_PUBLIC_KEY",
                    "--fileProcessorServicePublicKey=\\$FILE_PROCESSOR_SERVICE_PUBLIC_KEY",
                    "--servicePrivateKey=\\$JOB_QUEUE_SERVICE_PRIVATE_KEY",
                    "--tokenAgentSecret=\\$TOKEN_AGENT_SECRET",
                    "--apnsCertificate=\\$APNS_CERTIFICATE",
                    "--apnsCertificatePrivateKey=\\$APNS_CERTIFICATE_PRIVATE_KEY",
                    "--githubAppPrivateKey=\\$GITHUB_APP_PRIVATE_KEY",
                ].join(" ")}`,
            ],
            healthCheck: {
                command: [
                    "CMD-SHELL",
                    // `curl` is not installed in container. Use a script with our Node.js binary to
                    // perform healthcheck.
                    `/var/www/server/jobs/queue/queue.runfiles/nodejs_linux_arm64/bin/nodejs/bin/node --input-type module --eval "import fs from 'fs'; if (fs.readFileSync('/var/www-data/server_jobs_queue_healthcheck.txt', 'utf8').trim() !== 'Healthy') { throw new Error('Healthcheck failed') }"`,
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

        new Ec2Service(this, "Service", {
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
    }
}
