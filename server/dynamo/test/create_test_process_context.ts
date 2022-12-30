import {AwsClient} from "aws4fetch";
import fs from "fs-extra";
import getPort from "get-port";
import path from "path";
import {startDynamoLocal} from "~/admin/dynamo/start_dynamo_local";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {UnauthenticatedAuthContextModule} from "~/server/dynamo/context/auth_context_module";
import {ProcessContext, ProcessContextModules} from "~/server/dynamo/context/process_context";
import {UnauthenticatedRequestContext} from "~/server/dynamo/context/request_context";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {InternalError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
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
        const baseDataPath = path.join(
            runfilesPath,
            "cyberworlds/admin/dynamo/dynamo_local_base_data",
        );

        const dataPath = await fs.mkdtemp(
            path.join(assertExists(process.env.TEST_TMPDIR), "dynamo_local_data_"),
        );

        await fs.ensureDir(dataPath);

        // Copy our base data into a temporary test data directory. Our test will write
        // to the copied database, leaving the base database alone. The test database
        // will be thrown away when we are done.
        const baseDataFileNames = await fs.readdir(baseDataPath);
        await runAllPromises(
            baseDataFileNames.map(async name => {
                const stream = fs
                    .createReadStream(path.join(baseDataPath, name))
                    .pipe(fs.createWriteStream(path.join(dataPath, name)));

                await new Promise(resolve => stream.on("finish", resolve));
            }),
        );

        const port = await getPort();
        dynamoLocal = await startDynamoLocal({dataPath, port});

        const awsClient = new AwsClient({
            accessKeyId: "local",
            secretAccessKey: "local",
        });

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
