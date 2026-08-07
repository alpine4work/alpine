import {spawn} from "child_process";
import {join as joinPath} from "path";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

const migrationName = process.argv[2] ?? "";

const env = parseDotenv();

const parsePort = (portString: string | undefined) => {
    assert(portString);
    const port = parseInt(portString, 10);
    assert(!isNaN(port));
    return port;
};

// Assign AWS env variables to `process.env` so `@aws-sdk/credential-provider-node`
// picks them up.
process.env.AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;

const honeycombApiKey = env.HONEYCOMB_API_KEY;

const dynamoLocalPort = parsePort(env.DYNAMO_LOCAL_PORT);
const opensearchLocalPort = parsePort(env.OPENSEARCH_LOCAL_PORT);
const sqsLocalPort = parsePort(env.SQS_LOCAL_PORT);
const edgeDevPort = parsePort(env.EDGE_DEV_PORT);
const resourceDevPort = parsePort(env.RESOURCES_DEV_PORT);
const edgeServiceUrl = `http://localhost:${edgeDevPort}`;
const resourceServiceUrl = `http://localhost:${resourceDevPort}`;

const ensureLocalCachePath = joinPath(devEnvPaths.cache, "ensure");

const migrationExecutablePath = joinPath(runfilesPath, "cyberworlds/server/migration/migration.sh");

const subprocess = spawn(
    migrationExecutablePath,
    [
        `--migration=${migrationName}`,
        `--ensureLocalCachePath=${ensureLocalCachePath}`,
        `--dynamoLocalPort=${dynamoLocalPort}`,
        `--opensearchLocalPort=${opensearchLocalPort}`,
        `--jobQueueUrl=http://localhost:${sqsLocalPort}/local/JobQueue`,
        // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
        // original job queue url
        `--fileProcessorJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorJobQueue`,
        `--fileProcessorLightJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorLightJobQueue`,
        `--fileProcessorHeavyJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorHeavyJobQueue`,
        `--edgeServiceUrl=${edgeServiceUrl}`,
        `--resourceServiceUrl=${resourceServiceUrl}`,
        ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
    ],
    {
        stdio: ["inherit", "inherit", "inherit"],
    },
);

subprocess.on("error", error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});

subprocess.on("exit", exitCode => {
    process.exit(exitCode ?? process.exitCode ?? 0);
});
