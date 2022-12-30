// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// the `aws4fetch` module for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {AwsClient} from "aws4fetch";
import fs from "fs-extra";
import getPort from "get-port";
import path from "path";
import {executeAdminDynamoCommand} from "~/admin/dynamo/execute_admin_dynamo_command";
import {startDynamoLocal} from "~/admin/dynamo/start_dynamo_local";
import {UnauthenticatedAuthContextModule} from "~/server/dynamo/context/auth_context_module";
import {ProcessContext, ProcessContextModules} from "~/server/dynamo/context/process_context";
import {UnauthenticatedRequestContext} from "~/server/dynamo/context/request_context";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {getAllDynamoTableSchemas} from "~/server/dynamo/get_all_dynamo_table_schemas";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {TracerRoot} from "~/shared/tracer/tracer_root";

// This file runs in Node.js. We can only import it in Jest tests.
assert(typeof jest !== "undefined");

/**
 * Create a mock test context for Jest tests. It executes all DynamoDB commands
 * against DynamoDB database that is local to this test.
 */
export function createTestProcessContext(): () => ProcessContext & {
    request: () => UnauthenticatedRequestContext;
} {
    const tracer = TracerRoot.new({
        serviceName: "Test",
        jsHost: "Node",
        untrusted: false,
        getTime: () => Date.now(),
        sendEvent: () => {
            // We ignore all events generated in tests. Maybe we should write them to
            // a log file?
        },
    });

    let sharedContext: (ProcessContext & {request: () => UnauthenticatedRequestContext}) | null =
        null;
    let dynamoLocal: {stop: () => Promise<void>} | null = null;

    beforeAll(async () => {
        const dataPath = await fs.mkdtemp(
            path.join(assertExists(process.env.TEST_TMPDIR), "dynamo_local_data_"),
        );

        const port = await getPort();
        dynamoLocal = await startDynamoLocal({dataPath, port});

        const awsClient = new AwsClient({
            accessKeyId: "local",
            secretAccessKey: "local",
        });

        // Create all the tables we'll need in the DynamoDB database. We should
        // consider lazily creating tables as we need them for performance.
        for (const tableSchema of getAllDynamoTableSchemas()) {
            const tableName = tableSchema.getName();

            await executeAdminDynamoCommand<types.CreateTableInput>(
                awsClient,
                `http://localhost:${port}`,
                "CreateTable",
                {
                    TableName: tableName,
                    AttributeDefinitions: [
                        {
                            AttributeName: "partitionKey",
                            AttributeType: "S",
                        },
                        {
                            AttributeName: "sortKey",
                            AttributeType: "S",
                        },
                    ],
                    KeySchema: [
                        {
                            AttributeName: "partitionKey",
                            KeyType: "HASH",
                        },
                        {
                            AttributeName: "sortKey",
                            KeyType: "RANGE",
                        },
                    ],
                    BillingMode: "PAY_PER_REQUEST",
                },
            );
        }

        const context = Context.new<ProcessContextModules>({
            process: ProcessContextModule.test(),
            tracer: new TracerContextModule(tracer),
            dynamo: new DynamoContextModule(awsClient, `http://localhost:${port}`),
            email: new NoopEmailContextModule(),
        });

        const createRequestContext = (): UnauthenticatedRequestContext => {
            return context.clone({
                auth: new UnauthenticatedAuthContextModule(async () => null),
            });
        };

        sharedContext = Object.assign(context, {request: createRequestContext});
    });

    afterAll(async () => {
        await dynamoLocal?.stop();
    });

    return () => {
        if (sharedContext === null) throw new InternalError("Context has not yet initialized");
        return sharedContext;
    };
}
