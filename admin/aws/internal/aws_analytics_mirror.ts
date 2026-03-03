import {Duration, Stack, aws_events, aws_events_targets} from "aws-cdk-lib";
import {CfnDatabase, CfnTable} from "aws-cdk-lib/aws-glue";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";
import {S3EventSourceV2} from "aws-cdk-lib/aws-lambda-event-sources";
import {Bucket, EventType} from "aws-cdk-lib/aws-s3";
import {Construct} from "constructs";
import {
    accountEmailAddressesDimensionS3Prefix,
    accountsDimensionS3Prefix,
    generateAccountDimensionGlueSchema,
    generateAccountEmailAddressDimensionGlueSchema,
    generateSpaceAccountDimensionGlueSchema,
    generateSpaceDimensionGlueSchema,
    generateSpaceEmailDomainDimensionGlueSchema,
    generateStripeCustomerDimensionGlueSchema,
    spaceAccountsDimensionS3Prefix,
    spaceEmailDomainsDimensionS3Prefix,
    spacesDimensionS3Prefix,
    stripeCustomersDimensionS3Prefix,
} from "~/admin/analytics/analytics_mirror_export/dimension_table_schemas.js";
import {AwsObservability} from "~/admin/aws/internal/aws_observability.js";
import {AwsSqs} from "~/admin/aws/internal/aws_sqs.js";
import {AwsLambda} from "~/admin/aws/internal/constructs/aws_lambda.js";
/**
 * For now, this is an incredibly simple service that exports data from DynamoDB to
 * S3 and then transforms it into Glue tables that can be joined. In data
 * lake/warehouse terms, these are considered "dimensions" that are joined with
 * "facts" in Athena queries, where the fact table is `tracer.events`.
 *
 * This is really just another way to say that these tables will be used to enrich
 * tracer.events with additional context (about spaces and accounts for now).
 *
 * The architecture is as follows:
 *
 * - Trigger Lambda: Triggers DynamoDB exports daily at 4 AM UTC
 * - Transform Lambda: Transforms DynamoDB exports into Glue tables
 *
 * The nice thing about this architecture is that we can also run exports on-demand
 * by simply triggering the trigger Lambda.
 */
export class AwsAnalyticsMirror extends Construct {
    constructor(
        parentConstruct: Construct,
        {
            sqs,
            cloudflareAccountId,
            observability,
        }: {
            sqs: AwsSqs;
            cloudflareAccountId: string;
            observability: AwsObservability;
        },
    ) {
        super(parentConstruct, "AwsAnalyticsMirror");

        const accountId = Stack.of(this).account;
        const region = Stack.of(this).region;

        const exportBucket = new Bucket(this, "ExportBucket", {
            bucketName: `analytics-mirror`,
        });
        const exportBucketPrefix = "raw-exports";

        // ==========================================================================
        // Analytics Mirror Export Infrastructure
        // ========================================================================== These
        // Lambdas export DynamoDB tables (Accounts, Spaces) to S3 and transform the
        // exports into dimension tables that can be joined with tracer events in Athena.

        // Lambda to trigger DynamoDB exports daily
        const triggerAnalyticsMirrorExportLambda = new AwsLambda(
            this,
            "TriggerAnalyticsMirrorExport",
            {
                bazelConfiguration: {
                    bazelTarget:
                        "//admin/analytics/analytics_mirror_export:trigger_analytics_mirror_export_lambda",
                    handlerFilePath:
                        "analytics/analytics_mirror_export/trigger_analytics_mirror_export_lambda",
                },
                sqs,
                cloudflareAccountId,
                vpc: null,
                timeout: Duration.minutes(1),
                honeycombApiKey: null,
                memorySize: 256,
                environment: {
                    EXPORT_BUCKET: exportBucket.bucketName,
                    EXPORT_BUCKET_PREFIX: exportBucketPrefix,
                    // Table ARNs are constructed from the table names. In a real deployment, you would
                    // get these from dynamo.export() or pass them explicitly.
                    ACCOUNTS_TABLE_ARN: `arn:aws:dynamodb:${region}:${accountId}:table/Accounts`,
                    SPACES_TABLE_ARN: `arn:aws:dynamodb:${region}:${accountId}:table/Spaces`,
                },
                observability,
            },
        );

        // Grant permissions to trigger DynamoDB exports
        triggerAnalyticsMirrorExportLambda.executionRole.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["dynamodb:ExportTableToPointInTime"],
                resources: [
                    `arn:aws:dynamodb:${region}:${accountId}:table/Accounts`,
                    `arn:aws:dynamodb:${region}:${accountId}:table/Spaces`,
                ],
            }),
        );

        // Grant permission to write exports to S3
        exportBucket.grantWrite(triggerAnalyticsMirrorExportLambda.executionRole);

        // Schedule the trigger Lambda to run daily at 4 AM UTC
        new aws_events.Rule(this, "TriggerAnalyticsMirrorExportSchedule", {
            schedule: aws_events.Schedule.cron({hour: "4", minute: "0"}),
            targets: [
                new aws_events_targets.LambdaFunction(
                    triggerAnalyticsMirrorExportLambda.lambdaFunction,
                ),
            ],
        });

        const transformedDataPrefix = "parquet";
        // Lambda to transform DynamoDB exports into dimension tables
        const transformAnalyticsMirrorExportLambda = new AwsLambda(
            this,
            "TransformAnalyticsMirrorExport",
            {
                bazelConfiguration: {
                    bazelTarget:
                        "//admin/analytics/analytics_mirror_export:transform_analytics_mirror_export_lambda",
                    handlerFilePath:
                        "analytics/analytics_mirror_export/transform_analytics_mirror_export_lambda",
                },
                sqs,
                cloudflareAccountId,
                vpc: null,
                timeout: Duration.minutes(5),
                honeycombApiKey: null,
                memorySize: 1024, // Larger memory for processing exports
                environment: {
                    OUTPUT_BUCKET: exportBucket.bucketName,
                    OUTPUT_PREFIX: transformedDataPrefix,
                },
                observability,
            },
        );

        // Grant S3 read/write permissions for the transform Lambda
        exportBucket.grantReadWrite(transformAnalyticsMirrorExportLambda.executionRole);

        // Trigger the transform Lambda when DynamoDB export manifests are written The
        // manifest file is written last when an export completes
        transformAnalyticsMirrorExportLambda.lambdaFunction.addEventSource(
            new S3EventSourceV2(exportBucket, {
                events: [EventType.OBJECT_CREATED],
                filters: [{prefix: `${exportBucketPrefix}/`, suffix: "manifest-files.json"}],
            }),
        );

        createGlueDatabase(this, {
            accountId,
            s3Location: `${exportBucket.bucketName}/${transformedDataPrefix}`,
        });
    }
}

function createGlueDatabase(
    parentConstruct: Construct,
    {accountId, s3Location}: {accountId: string; s3Location: string},
) {
    const databaseName = "app";
    // Create Glue database and tables for dimension data (accounts, spaces). These
    // dimension tables are populated by daily DynamoDB exports and can be joined with
    // tracer events in Athena queries.
    const appDimensionGlueDatabase = new CfnDatabase(parentConstruct, "AppDimensionGlueDatabase", {
        catalogId: Stack.of(parentConstruct).account,
        databaseInput: {
            name: databaseName,
            description: "Database for analytics dimension tables (accounts, spaces)",
        },
    });

    // Accounts dimension table - allowlisted columns from DynamoDB Accounts table
    const accountsDimensionGlueTable = new CfnTable(parentConstruct, "AccountsDimensionGlueTable", {
        catalogId: accountId,
        databaseName,
        tableInput: {
            name: "accounts",
            description: "Accounts dimension table with allowlisted columns",
            tableType: "EXTERNAL_TABLE",
            parameters: {
                classification: "json",
            },
            storageDescriptor: {
                columns: generateAccountDimensionGlueSchema(),
                location: `s3://${s3Location}/${accountsDimensionS3Prefix}/`,
                inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
                outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                serdeInfo: {
                    serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
                    parameters: {
                        "serialization.format": "1",
                    },
                },
            },
        },
    });
    accountsDimensionGlueTable.addDependency(appDimensionGlueDatabase);

    // Spaces dimension table - allowlisted columns from DynamoDB Spaces table
    const spacesDimensionGlueTable = new CfnTable(parentConstruct, "SpacesDimensionGlueTable", {
        catalogId: Stack.of(parentConstruct).account,
        databaseName,
        tableInput: {
            name: "spaces",
            description: "Spaces dimension table with allowlisted columns",
            tableType: "EXTERNAL_TABLE",
            parameters: {
                classification: "json",
            },
            storageDescriptor: {
                columns: generateSpaceDimensionGlueSchema(),
                location: `s3://${s3Location}/${spacesDimensionS3Prefix}/`,
                inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
                outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                serdeInfo: {
                    serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
                    parameters: {
                        "serialization.format": "1",
                    },
                },
            },
        },
    });
    spacesDimensionGlueTable.addDependency(appDimensionGlueDatabase);

    // Account email addresses dimension table - email addresses per account (1:N)
    const accountEmailAddressesDimensionGlueTable = new CfnTable(
        parentConstruct,
        "AccountEmailAddressesDimensionGlueTable",
        {
            catalogId: Stack.of(parentConstruct).account,
            databaseName,
            tableInput: {
                name: "account_email_addresses",
                description: "Account email addresses dimension table",
                tableType: "EXTERNAL_TABLE",
                parameters: {
                    classification: "json",
                },
                storageDescriptor: {
                    columns: generateAccountEmailAddressDimensionGlueSchema(),
                    location: `s3://${s3Location}/${accountEmailAddressesDimensionS3Prefix}/`,
                    inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
                    outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    serdeInfo: {
                        serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
                        parameters: {
                            "serialization.format": "1",
                        },
                    },
                },
            },
        },
    );
    accountEmailAddressesDimensionGlueTable.addDependency(appDimensionGlueDatabase);

    // Stripe customers dimension table - Stripe customer to account mapping
    const stripeCustomersDimensionGlueTable = new CfnTable(
        parentConstruct,
        "StripeCustomersDimensionGlueTable",
        {
            catalogId: Stack.of(parentConstruct).account,
            databaseName,
            tableInput: {
                name: "stripe_customers",
                description: "Stripe customers dimension table",
                tableType: "EXTERNAL_TABLE",
                parameters: {
                    classification: "json",
                },
                storageDescriptor: {
                    columns: generateStripeCustomerDimensionGlueSchema(),
                    location: `s3://${s3Location}/${stripeCustomersDimensionS3Prefix}/`,
                    inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
                    outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    serdeInfo: {
                        serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
                        parameters: {
                            "serialization.format": "1",
                        },
                    },
                },
            },
        },
    );
    stripeCustomersDimensionGlueTable.addDependency(appDimensionGlueDatabase);

    // Space accounts dimension table - space-account membership (N:N)
    const spaceAccountsDimensionGlueTable = new CfnTable(
        parentConstruct,
        "SpaceAccountsDimensionGlueTable",
        {
            catalogId: Stack.of(parentConstruct).account,
            databaseName,
            tableInput: {
                name: "space_accounts",
                description: "Space accounts dimension table for membership data",
                tableType: "EXTERNAL_TABLE",
                parameters: {
                    classification: "json",
                },
                storageDescriptor: {
                    columns: generateSpaceAccountDimensionGlueSchema(),
                    location: `s3://${s3Location}/${spaceAccountsDimensionS3Prefix}/`,
                    inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
                    outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    serdeInfo: {
                        serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
                        parameters: {
                            "serialization.format": "1",
                        },
                    },
                },
            },
        },
    );
    spaceAccountsDimensionGlueTable.addDependency(appDimensionGlueDatabase);

    // Space email domains dimension table - auto-add domains per space
    const spaceEmailDomainsDimensionGlueTable = new CfnTable(
        parentConstruct,
        "SpaceEmailDomainsDimensionGlueTable",
        {
            catalogId: Stack.of(parentConstruct).account,
            databaseName,
            tableInput: {
                name: "space_email_domains",
                description: "Space email domains for auto-add accounts feature",
                tableType: "EXTERNAL_TABLE",
                parameters: {
                    classification: "json",
                },
                storageDescriptor: {
                    columns: generateSpaceEmailDomainDimensionGlueSchema(),
                    location: `s3://${s3Location}/${spaceEmailDomainsDimensionS3Prefix}/`,
                    inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
                    outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    serdeInfo: {
                        serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
                        parameters: {
                            "serialization.format": "1",
                        },
                    },
                },
            },
        },
    );
    spaceEmailDomainsDimensionGlueTable.addDependency(appDimensionGlueDatabase);
}
