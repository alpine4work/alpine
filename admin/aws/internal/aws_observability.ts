import {Duration, Tags} from "aws-cdk-lib";
import {IGrantable, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {CfnDeliveryStream, DeliveryStream, IDeliveryStream} from "aws-cdk-lib/aws-kinesisfirehose";
import {Bucket, IBucket} from "aws-cdk-lib/aws-s3";
import {Secret} from "aws-cdk-lib/aws-secretsmanager";
import {CfnAssociation, ParameterTier, StringParameter} from "aws-cdk-lib/aws-ssm";
import {Construct, IConstruct} from "constructs";
import {cloudwatchAgentConfig} from "~/admin/aws/internal/cloudwatch_agent_config.js";

/**
 * Construct to set up shared observability resources for our infrastructure and services.
 *
 * - Creates a shared S3 bucket for storing logs and raw tracer events. Logs should be stored under the
 * the `logsBucketPrefix` and tracer events should be stored under the `tracerEventBucketPrefix` to
 * ensure the correct lifecycle rules are applied.
 *
 * - Sets up a Kinesis Data Firehose delivery stream for sending tracer events to Honeycomb and
 * S3. You must grant your IAM role permission to write to the firehose delivery stream.
 *
 * - Sets up a Systems Manager association that will install, configure, and start the CloudWatch Agent
 * on any instance tagged with `CloudWatchAgent=true`.
 */
export class AwsObservability {
    public readonly loggingBucket: IBucket;
    public readonly tracerEventStream: IDeliveryStream;
    public readonly logsBucketPrefix: string;
    public readonly tracerEventBucketPrefix: string;
    public readonly tracerEventStreamName: string;

    // These are static so they can be accessed by the `new` method, but aren't intended to be used
    // publicly outside of the class. You should use the instance properties instead.
    static _logsBucketPrefix = "logs/";
    static _tracerEventBucketPrefix = "tracer/events";
    static _tracerEventStreamName = "tracer-events";

    private constructor(loggingBucket: IBucket, tracerEventStream: IDeliveryStream) {
        this.loggingBucket = loggingBucket;
        this.tracerEventStream = tracerEventStream;

        // Make our static properties accessible to the instance.
        this.logsBucketPrefix = AwsObservability._logsBucketPrefix;
        this.tracerEventBucketPrefix = AwsObservability._tracerEventBucketPrefix;
        this.tracerEventStreamName = AwsObservability._tracerEventStreamName;
    }

    public static new(parentConstruct: Construct): AwsObservability {
        const construct = new Construct(parentConstruct, "AwsObservability");

        const loggingBucket = new Bucket(construct, "LoggingBucket", {
            bucketName: "cyberworlds-observability-logs",
            versioned: false,
            lifecycleRules: [{expiration: Duration.days(90), prefix: this._logsBucketPrefix}],
        });

        const cloudwatchAgentConfigParameter = new StringParameter(
            construct,
            "CloudWatchAgentConfigParam",
            {
                parameterName: "AmazonCloudWatch-linux",
                stringValue: cloudwatchAgentConfig,
                tier: ParameterTier.STANDARD,
            },
        );

        // This sets up a Systems Manager association that runs the AWS-managed
        // `AWSQuickSetupType-InstallAndManageCloudWatchAgent` document on instance startup.
        // This document installs the CloudWatch Agent package, configures it using an SSM parameter,
        // and starts it. Any instance tagged with `CloudWatchAgent=true` will be targeted by this
        // association.
        new CfnAssociation(construct, "InstallAndManageCloudWatchAgent", {
            name: "AWSQuickSetupType-InstallAndManageCloudWatchAgent",
            targets: [
                {
                    key: "tag:CloudWatchAgent",
                    values: ["true"],
                },
            ],
            parameters: {
                isInstall: ["true"],
                isConfigure: ["true"],
                optionalConfigurationSource: ["ssm"],
                optionalConfigurationLocation: [cloudwatchAgentConfigParameter.parameterName],
                optionalRestart: ["yes"],
            },
        });

        const secrets = Secret.fromSecretNameV2(
            construct,
            "SecretsImport",
            "TracerEventStreamSecrets",
        );

        const firehoseRole = new Role(construct, "FirehoseRole", {
            assumedBy: new ServicePrincipal("firehose.amazonaws.com"),
        });

        loggingBucket.grantWrite(firehoseRole);
        secrets.grantRead(firehoseRole);

        const tracerFirehoseDeliveryStreamCfn = new CfnDeliveryStream(
            construct,
            "TracerHoneycombFirehoseDeliveryStream",
            {
                deliveryStreamName: this._tracerEventStreamName,
                deliveryStreamType: "DirectPut",
                httpEndpointDestinationConfiguration: {
                    endpointConfiguration: {
                        url: "https://api.honeycomb.io/1/kinesis_events/tracer",
                        name: "Honeycomb Tracer Events Destination",
                        accessKey: secrets.secretValueFromJson("honeycombApiKey").unsafeUnwrap(),
                    },
                    s3BackupMode: "AllData",
                    s3Configuration: {
                        bucketArn: loggingBucket.bucketArn,
                        roleArn: firehoseRole.roleArn,
                        prefix: `${this._tracerEventBucketPrefix}/raw`,
                    },
                    secretsManagerConfiguration: {
                        enabled: true,
                        roleArn: firehoseRole.roleArn,
                        secretArn: secrets.secretArn,
                    },
                },
            },
        );

        const tracerFirehoseDeliveryStream = DeliveryStream.fromDeliveryStreamArn(
            construct,
            "TracerEventsHoneycombFirehoseDeliveryStream",
            tracerFirehoseDeliveryStreamCfn.attrArn,
        );

        return new AwsObservability(loggingBucket, tracerFirehoseDeliveryStream);
    }

    public grantPutToTracerEventStream(grantee: IGrantable) {
        this.tracerEventStream.grantPutRecords(grantee);
    }

    public installCloudWatchAgent(construct: IConstruct) {
        Tags.of(construct).add("CloudWatchAgent", "true");
    }
}
