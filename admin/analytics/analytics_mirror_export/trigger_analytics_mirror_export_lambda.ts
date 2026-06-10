import {DynamoDBClient, ExportTableToPointInTimeCommand} from "@aws-sdk/client-dynamodb";
import {ScheduledHandler} from "aws-lambda";
import {withLambdaTimeout} from "~/server/lambda/helpers/with_lambda_timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const dynamoClient = new DynamoDBClient({});

const exportBucket = assertExists(
    process.env.EXPORT_BUCKET,
    "EXPORT_BUCKET environment variable is required",
);

const accountsTableArn = assertExists(
    process.env.ACCOUNTS_TABLE_ARN,
    "ACCOUNTS_TABLE_ARN environment variable is required",
);

const spacesTableArn = assertExists(
    process.env.SPACES_TABLE_ARN,
    "SPACES_TABLE_ARN environment variable is required",
);

const exportBucketPrefix = assertExists(
    process.env.EXPORT_BUCKET_PREFIX,
    "EXPORT_BUCKET_PREFIX environment variable is required",
);
/**
 * Lambda handler that triggers DynamoDB exports for dimension tables.
 *
 * This Lambda is scheduled to run daily and triggers point-in-time exports for the
 * Accounts and Spaces tables. The exports are written to S3 and trigger the
 * transform Lambda when complete.
 */
export const handler: ScheduledHandler = async (event, context) => {
    await withLambdaTimeout(context, new AbortController(), async () => {
        // eslint-disable-next-line no-console
        console.log("Triggering DynamoDB exports for dimension tables");

        const exports = [
            {tableArn: accountsTableArn, tableName: "Accounts"},
            {tableArn: spacesTableArn, tableName: "Spaces"},
        ];

        for (const {tableArn, tableName} of exports) {
            try {
                const result = await dynamoClient.send(
                    new ExportTableToPointInTimeCommand({
                        TableArn: tableArn,
                        S3Bucket: exportBucket,
                        S3Prefix: `${exportBucketPrefix}/${tableName}`,
                        ExportFormat: "DYNAMODB_JSON",
                    }),
                );

                // eslint-disable-next-line no-console
                console.log(
                    `Started export for ${tableName}: ${result.ExportDescription?.ExportArn}`,
                );
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error(`Failed to start export for ${tableName}:`, error);
                throw error;
            }
        }

        // eslint-disable-next-line no-console
        console.log("All exports triggered successfully");
    });
};
