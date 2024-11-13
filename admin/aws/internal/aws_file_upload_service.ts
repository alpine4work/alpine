import {Duration} from "aws-cdk-lib";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {InstanceSize, InstanceType, Port, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    AsgCapacityProvider,
    ContainerImage,
    Ec2Service,
    Ec2TaskDefinition,
    EcsOptimizedImage,
    Secret as EcsSecret,
    NetworkMode,
} from "aws-cdk-lib/aws-ecs";
import {ApplicationLoadBalancer, ApplicationProtocol} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {ManagedPolicy} from "aws-cdk-lib/aws-iam";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {Construct} from "constructs";
import {join as joinPath} from "path";
import {AwsDynamo} from "~/admin/aws/internal/aws_dynamo.js";
import {AwsEcsCluster} from "~/admin/aws/internal/aws_ecs_cluster.js";
import {awsServiceInstanceClass} from "~/admin/aws/internal/aws_service_instance_class.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {uploadFileTimeoutMs} from "~/shared/files/upload_file_event.js";

// IMPORTANT: `FileUploadService` has a pretty broad attack surface given all
// the libraries it uses to process dependencies. `FileUploadService` uses:
//
// - [`sharp`][1] which itself has a bunch of dependencies including
//   [GraphicsMagick and PDFium][2]
// - [FFmpeg][3]
// - [LibreOffice][4]
//
// These libraries are massive and have many opportunities to be exploited. One
// possible simple exploit that comes to mind is using one of these libraries
// to process a file with an embedded URL that points to an image. If the file
// format goes to fetch the URL then the attack now knows `FileUploadService`'s
// IP address and can try to perform more attacks. (Knowing the IP alone
// shouldn't give the attacker much but it does mean we have to be very careful
// about what ports we expose to the network.)
//
// As such we're very strict about what permissions we grant to
// `FileUploadService` as an extra layer of security. If we grant the absolute
// minimum set of permissions `FileUploadService` needs then even if an
// attacker is able to compromise a `FileUploadService` EC2 instance they won't
// be able to do much with it. As of 2024-11-12 we only give
// `FileUploadService` the ability to read from the `Accounts`/`Spaces` table
// and read/write to the `Files` table. We do not give access to the DynamoDB
// `Scan` action. An attacker can't do too much harm with this set of
// permissions.
//
// To be clear, we don't know of any vulnerabilities that allow attackers to
// compromise `FileUploadService` and if we discover any vulnerabilities we
// should fix them immediately. The permissions we grant `FileUploadService` is
// an additional precaution.
//
// [1]: https://www.npmjs.com/package/sharp
// [2]: https://github.com/cyberworlds/sharp-libvips/blob/174959af63c6f3dd25b1339b8d3fc2bfc289a176/THIRD-PARTY-NOTICES.md
// [3]: https://www.ffmpeg.org
// [4]: https://www.libreoffice.org
export class AwsFileUploadService extends Construct {
    constructor(
        parentConstruct: Construct,
        {
            vpc,
            ecsCluster,
            cloudflareAccountId,
            dynamo,
            sqs,
        }: {
            vpc: Vpc;
            ecsCluster: AwsEcsCluster;
            cloudflareAccountId: string;
            dynamo: AwsDynamo;
            sqs: AwsSqs;
        },
    ) {
        super(parentConstruct, "FileUploadService");

        const autoScalingGroup = new AutoScalingGroup(this, "AutoScalingGroup", {
            vpc,
            // First 750 hours per month of this instance type are free. That effectively
            // translates to 1 free capacity of this instance type across our AWS account.
            instanceType: InstanceType.of(awsServiceInstanceClass, InstanceSize.MICRO),
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

        const autoScalingGroupCapacityProvider = new AsgCapacityProvider(
            this,
            "AutoScalingGroupCapacityProvider",
            {autoScalingGroup},
        );

        ecsCluster.cluster.addAsgCapacityProvider(autoScalingGroupCapacityProvider);

        const port = 4000;
        const secrets = Secret.fromSecretNameV2(this, "SecretsImport", "FileUploadServiceSecrets");

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
                    process.env.CDK_LITE === "true"
                        ? "cyberworlds/admin/aws/empty_image_tarball_load/tarball.tar"
                        : "cyberworlds/server/files/upload/upload_image_tarball_load/tarball.tar",
                ),
            ),
            // This appears to be the available memory for our containers. Unclear how we
            // get this number from 1024 (the instance type's memory). It makes sense that
            // we'd need some overhead for ECS.
            memoryLimitMiB: 944,
            // Send logs to AWS. Container logs are short-lived and used for debugging
            // obscure machine-level issues. Our long-lived logs are in Honeycomb.
            logging: ecsCluster.shortLivedLogDriver,
            // Increase stop timeout to one minute longer than the file upload timeout.
            // Right now the file upload timeout is 5min (videos which need to transcode
            // may take a while to process) which makes this timeout 6min. That's very
            // long! It'll mean our deploys take longer to finish.
            //
            // I (@calebmer) think eventually we should move some file processing (e.g.
            // video transcoding) to an SQS queue to improve reliability (we'll be able to
            // retry file processing). Doing this also means we can lower this stop
            // timeout. If our video transcoder is, say, an AWS Lambda with no dependencies
            // on our JavaScript code then it won't need to restart during a deploy.
            stopTimeout: Duration.millis(uploadFileTimeoutMs + 1000 * 60),
            // For security, use the `www-data` user which exists on our Linux image. It
            // only has read access and execute access to files on our system.
            user: "www-data",
            portMappings: [{containerPort: port, hostPort: port}],
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
                FILE_UPLOAD_SERVICE_PUBLIC_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "fileUploadServicePublicKey",
                ),
                FILE_UPLOAD_SERVICE_PRIVATE_KEY: EcsSecret.fromSecretsManager(
                    secrets,
                    "fileUploadServicePrivateKey",
                ),
                TOKEN_AGENT_SECRET: EcsSecret.fromSecretsManager(secrets, "tokenAgentSecret"),
                HONEYCOMB_API_KEY: EcsSecret.fromSecretsManager(secrets, "honeycombApiKey"),
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
                `/var/www/server/files/upload/upload ${[
                    `--port=${port}`,
                    "--temporaryDirectoryPath=/var/www-data/files",
                    // IMPORTANT: Even though we provide a URL to SQS we don't grant
                    // `FileUploadService` the ability to send events to this queue. This reduces
                    // what an attacker can do with a compromised `FileUploadService`. Queued jobs
                    // escalate permissions to a space system actor. It's dangerous to give access
                    // to this capability.
                    `--jobQueueUrl=${sqs.getJobQueueUrl()}`,
                    "--honeycombApiKey=$HONEYCOMB_API_KEY",
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
                    "--fileUploadServicePublicKey=\\$FILE_UPLOAD_SERVICE_PUBLIC_KEY",
                    "--servicePrivateKey=\\$FILE_UPLOAD_SERVICE_PRIVATE_KEY",
                    "--tokenAgentSecret=\\$TOKEN_AGENT_SECRET",
                ].join(" ")}`,
            ],
            healthCheck: {
                command: [
                    "CMD-SHELL",
                    // `curl` is not installed in container. Use a script with our Node.js binary to
                    // perform healthcheck.
                    `/var/www/server/files/upload/upload.runfiles/node_linux_amd64/bin/nodejs/bin/node --input-type module --eval "const response = await fetch('http://localhost:${port}/healthcheck'); if (!response.ok) { throw new Error('Healthcheck failed') }"`,
                ],
            },
        });

        // IMPORTANT: Only grant `FileUploadService` access to the tables it uses. This
        // reduces what an attacker can do with a compromised `FileUploadService`. They
        // won't be able to create new account sessions and won't be able to use `Scan`
        // to search for a `SessionId` to identify as. Even if an attacker is able to
        // correctly guess a `SessionId` they won't be able to generate a token to
        // log in as the compromised account since they don't have the required
        // `AppService` private key.
        //
        // Disallow queries so you can't read all sessions for an account or all
        // accounts in a space.
        dynamo.grantReadDataForTable(taskDefinition.taskRole, "Accounts", {disallowQuery: true});
        dynamo.grantReadDataForTable(taskDefinition.taskRole, "Spaces", {disallowQuery: true});
        dynamo.grantReadWriteDataForTable(taskDefinition.taskRole, "Files");

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

        const loadBalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
            vpc,
            loadBalancerName: "cyberworlds-files",
            internetFacing: true,
        });

        // Make sure the load balancer can make requests against our service.
        autoScalingGroup.connections.allowFrom(loadBalancer, Port.tcp(4000));

        const listener = loadBalancer.addListener("Listener", {
            protocol: ApplicationProtocol.HTTPS,
            port: 443,
            certificates: [
                new Certificate(this, "Certificate", {
                    domainName: "files.cyberworlds.dev",
                    validation: CertificateValidation.fromDns(),
                }),
            ],
        });

        listener.addTargets("TargetGroup", {
            targetGroupName: "cyberworlds-files-target-group",
            port: port,
            protocol: ApplicationProtocol.HTTP,
            targets: [service],
            healthCheck: {
                path: "/healthcheck",
                // Speed up deployment by requiring fewer healthy checks. Should only take
                // ~15 seconds to consider the service healthy.
                // https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/load-balancer-healthcheck.html
                interval: Duration.seconds(5),
                timeout: Duration.seconds(3),
                healthyThresholdCount: 3,
            },
            // See our comment on `stopTimeout`. File upload processing is potentially quite
            // slow so we need to increase the deregistration delay to make sure we don't
            // close connections that are still uploading during a deploy.
            deregistrationDelay: Duration.millis(uploadFileTimeoutMs),
        });
    }
}
