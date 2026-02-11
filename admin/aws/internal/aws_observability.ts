import {Duration, Stack, Tags} from "aws-cdk-lib";
import {CfnDatabase, CfnTable} from "aws-cdk-lib/aws-glue";
import {
    IGrantable,
    PolicyDocument,
    PolicyStatement,
    Role,
    ServicePrincipal,
    User,
} from "aws-cdk-lib/aws-iam";
import {Stream as KinesisDataStream, StreamEncryption, StreamMode} from "aws-cdk-lib/aws-kinesis";
import {CfnDeliveryStream, DeliveryStream, IDeliveryStream} from "aws-cdk-lib/aws-kinesisfirehose";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {CfnAssociation, ParameterTier, StringParameter} from "aws-cdk-lib/aws-ssm";
import {Construct, IConstruct} from "constructs";
import {cloudwatchAgentConfig} from "~/admin/aws/internal/cloudwatch_agent_config.js";
import {generateTracerEventGlueSchema} from "~/admin/glue/generate_tracer_event_glue_schema.js";

/**
 * Construct to set up shared observability resources for our infrastructure and services.
 *
 * - Creates a shared S3 bucket for storing logs and tracer events. Logs should be stored under
 * the `logsBucketPrefix` and tracer events should be stored under the `tracerEventBucketPrefix`
 * to ensure the correct lifecycle rules are applied.
 *
 * - Sets up a Kinesis Data Stream as the entry point for tracer events. Services write to this
 * stream which, for now, provides the data to single Firehose delivery stream:
 * - S3 delivery stream - Converts records to Parquet format for efficient querying
 *
 * Eventually we will add support for a Honeycomb delivery stream (see #local-kinesis TODOs).
 *
 * - Sets up a Systems Manager association that will install, configure, and start the CloudWatch
 * Agent on any instance tagged with `CloudWatchAgent=true`. This is used to collect metrics and
 * logs from the instance and send them to CloudWatch.
 */
export class AwsObservability extends Construct {
    private readonly _logsBucketPrefix = "logs/";
    private readonly _tracerEventBucketPrefix = "tracer/events";
    private readonly _tracerEventS3FirehoseStreamName = "tracer-events-s3";
    private readonly _tracerEventGlueDatabaseName = "tracer_events";

    private readonly _loggingBucket: Bucket;
    private readonly _tracerEventStream: KinesisDataStream;

    // TODO(ifitzsimmons): Remove this. We need to continue exporting this stream for now
    // in order to unblock CI. Without it, CloudFormation tries to delete the exported
    // resource but stops since it is used in other stacks
    private readonly _tracerHoneycombFirehoseDeliveryStream: IDeliveryStream;

    constructor(parentConstruct: Construct) {
        super(parentConstruct, "AwsObservability");

        this._loggingBucket = new Bucket(this, "LoggingBucket", {
            bucketName: "cyberworlds-observability-logs",
            versioned: false,
            lifecycleRules: [{expiration: Duration.days(90), prefix: this._logsBucketPrefix}],
        });

        const cloudwatchAgentConfigParameter = new StringParameter(
            this,
            "CloudWatchAgentConfigParam",
            {
                parameterName: "AmazonCloudWatch-linux-config",
                stringValue: cloudwatchAgentConfig,
                tier: ParameterTier.STANDARD,
            },
        );

        // This sets up a Systems Manager association that runs the AWS-managed
        // `AWSQuickSetupType-InstallAndManageCloudWatchAgent` document on instance startup.
        // This document installs the CloudWatch Agent package, configures it using an SSM parameter,
        // and starts it. Any instance tagged with `CloudWatchAgent=true` will be targeted by this
        // association.
        new CfnAssociation(this, "InstallAndManageCloudWatchAgent", {
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
            },
        });

        // Create the Kinesis Data Stream as the entry point for tracer events. Services write
        // records to this stream, and it fans out to multiple Firehose delivery streams.
        this._tracerEventStream = new KinesisDataStream(this, "TracerEventStream", {
            streamName: "tracer-events",
            streamMode: StreamMode.ON_DEMAND,
            encryption: StreamEncryption.MANAGED,
        });

        const user = createUserForKinesisStreamPuts(this, this._tracerEventStream);
        this._tracerEventStream.grantWrite(user);

        // Create Glue database and table for the Parquet schema. Firehose uses this schema
        // to convert JSON records to Parquet format.
        const glueDatabase = new CfnDatabase(this, "TracerEventsGlueDatabase", {
            catalogId: Stack.of(this).account,
            databaseInput: {
                name: this._tracerEventGlueDatabaseName,
                description: "Database for tracer event data stored in Parquet format",
            },
        });

        const glueTableName = "events";
        const glueTable = new CfnTable(this, "TracerEventsGlueTable", {
            catalogId: Stack.of(this).account,
            databaseName: this._tracerEventGlueDatabaseName,
            tableInput: {
                name: glueTableName,
                description: "Tracer events in Parquet format",
                tableType: "EXTERNAL_TABLE",
                parameters: {
                    classification: "parquet",
                },
                // NOTE(ifitzsimmons): This is absolutely derived from Stack Overflow [1]
                // [1]: https://stackoverflow.com/questions/71213512/how-to-add-serde-parameters-in-cdk
                storageDescriptor: {
                    columns: [...generateTracerEventGlueSchema()],
                    location: `s3://${this._loggingBucket.bucketName}/${this._tracerEventBucketPrefix}/parquet/`,
                    inputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                    outputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                    serdeInfo: {
                        serializationLibrary:
                            "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                        parameters: {
                            "serialization.format": "1",
                        },
                    },
                },
            },
        });
        glueTable.addDependency(glueDatabase);

        const baseGlueArn = `arn:aws:glue:${Stack.of(this).region}:${Stack.of(this).account}`;

        // Create Firehose IAM role for S3 delivery
        const s3FirehoseRole = new Role(this, "S3FirehoseRole", {
            assumedBy: new ServicePrincipal("firehose.amazonaws.com"),
            inlinePolicies: {
                // NOTE(ifitzsimmons): We need to create this inline because
                // CloudFormation will start deploying the firehose stream as soon
                // as the IAM role is created (and potentially before the policies)
                // are applied. However, in order to create a Firehose stream that
                // consumes the Kinesis stream, it needs to be able to describe the
                // stream.
                default: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            actions: ["kinesis:DescribeStream"],
                            resources: [this._tracerEventStream.streamArn],
                        }),
                        // https://repost.aws/knowledge-center/kinesis-firehose-convert-record-formats
                        new PolicyStatement({
                            actions: ["glue:GetDatabase", "glue:GetTable", "glue:GetTableVersion"],
                            resources: [
                                `${baseGlueArn}:catalog`,
                                `${baseGlueArn}:database/${this._tracerEventGlueDatabaseName}`,
                                `${baseGlueArn}:table/${this._tracerEventGlueDatabaseName}/${glueTableName}`,
                            ],
                        }),
                    ],
                }),
            },
        });

        this._loggingBucket.grantWrite(s3FirehoseRole);
        this._tracerEventStream.grantRead(s3FirehoseRole);

        // Grant Glue permissions for schema access during Parquet conversion
        s3FirehoseRole.addToPolicy(
            new PolicyStatement({
                actions: ["glue:GetTable", "glue:GetTableVersion", "glue:GetTableVersions"],
                resources: [
                    `arn:aws:glue:*:*:catalog`,
                    `arn:aws:glue:*:*:database/tracer_events`,
                    `arn:aws:glue:*:*:table/tracer_events/events`,
                ],
            }),
        );

        // Firehose delivery stream for S3 with Parquet format conversion
        // TODO(ifitzsimmons): We should use the L2 DeliveryStream construct instead of
        // CfnDeliveryStream. We need to update our CDK version and will likely need to
        // use the AWS CDK Toolkit to manage deploys [1].
        //
        // [1]: https://app.graphite.com/github/pr/cyberworlds/cyberworlds/1190/Add-infra-for-tracer-events-in-S3-and-start-sending-events-from-AWS-services#comment-PRRC_kwDOH2ktg86mAm3e
        new CfnDeliveryStream(this, "TracerS3FirehoseDeliveryStream", {
            deliveryStreamName: this._tracerEventS3FirehoseStreamName,
            deliveryStreamType: "KinesisStreamAsSource",
            kinesisStreamSourceConfiguration: {
                kinesisStreamArn: this._tracerEventStream.streamArn,
                roleArn: s3FirehoseRole.roleArn,
            },
            extendedS3DestinationConfiguration: {
                bucketArn: this._loggingBucket.bucketArn,
                roleArn: s3FirehoseRole.roleArn,
                prefix: `${this._tracerEventBucketPrefix}/parquet/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/`,
                errorOutputPrefix: `${this._tracerEventBucketPrefix}/parquet-errors/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/!{firehose:error-output-type}/`,
                bufferingHints: {
                    intervalInSeconds: 300, // 5 minutes
                    sizeInMBs: 128, // 128MB
                },
                compressionFormat: "UNCOMPRESSED", // Parquet handles its own compression
                dataFormatConversionConfiguration: {
                    enabled: true,
                    inputFormatConfiguration: {
                        deserializer: {
                            openXJsonSerDe: {},
                        },
                    },
                    outputFormatConfiguration: {
                        serializer: {
                            parquetSerDe: {},
                        },
                    },
                    schemaConfiguration: {
                        catalogId: Stack.of(this).account,
                        databaseName: this._tracerEventGlueDatabaseName,
                        tableName: glueTableName,
                        roleArn: s3FirehoseRole.roleArn,
                        region: Stack.of(this).region,
                    },
                },
            },
        });

        // TODO(ifitzsimmons): Remove this. We need to continue exporting this stream for now
        // in order to unblock CI. Without it, CloudFormation tries to delete the exported
        // resource but stops since it is used in other stacks
        {
            const tracerFirehoseDeliveryStreamCfn = new CfnDeliveryStream(
                this,

                "TracerHoneycombFirehoseDeliveryStream",
                {
                    deliveryStreamName: "tracer-events",
                    deliveryStreamType: "DirectPut",
                    httpEndpointDestinationConfiguration: {
                        endpointConfiguration: {
                            url: "https://api.honeycomb.io/1/kinesis_events/tracer",
                            name: "Honeycomb Tracer Events Destination",
                        },
                        s3BackupMode: "AllData",
                        s3Configuration: {
                            bucketArn: this._loggingBucket.bucketArn,
                            roleArn: s3FirehoseRole.roleArn,
                            prefix: `${this._tracerEventBucketPrefix}/raw`,
                        },
                    },
                },
            );
            this._tracerHoneycombFirehoseDeliveryStream = DeliveryStream.fromDeliveryStreamArn(
                this,
                "TracerEventsHoneycombFirehoseDeliveryStream",
                tracerFirehoseDeliveryStreamCfn.attrArn,
            );
        }
    }

    public get loggingBucket(): Bucket {
        return this._loggingBucket;
    }

    public get logsBucketPrefix(): string {
        return this._logsBucketPrefix;
    }

    public get tracerEventStreamName(): string {
        return this._tracerEventStream.streamName;
    }

    public grantPutToTracerEventStream(grantee: IGrantable) {
        this._tracerEventStream.grantWrite(grantee);
    }

    // TODO(ifitzsimmons): Remove this. We need to continue exporting this stream for now
    public grantPutToTracerHoneycombFirehoseDeliveryStream(grantee: IGrantable) {
        this._tracerHoneycombFirehoseDeliveryStream.grantPutRecords(grantee);
    }

    public installCloudWatchAgent(construct: IConstruct) {
        Tags.of(construct).add("CloudWatchAgent", "true");
    }
}

/**
 * IMPORTANT: This creates the user but DOES NOT CREATE THE ACCESS KEYS.
 *
 * You must manually go to the console, find the user, generate access keys,
 * and then set the access key ID and secret access key as secret variables
 * in Cloudflare (and whatever other external services we may need)
 */
function createUserForKinesisStreamPuts(parentConstruct: Construct, stream: KinesisDataStream) {
    const user = new User(parentConstruct, "KinesisStreamPutsUser", {
        userName: "kinesis-stream-puts-user",
    });

    user.addToPolicy(
        new PolicyStatement({
            actions: ["kinesis:PutRecords"],
            resources: [stream.streamArn],
        }),
    );

    return user;
}
