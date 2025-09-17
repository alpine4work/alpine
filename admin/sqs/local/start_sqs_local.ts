import {CreateQueueCommand, SQSClient} from "@aws-sdk/client-sqs";
import {spawn} from "child_process";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

const javaPathPromise = new Lazy(async () => {
    const javaPathPath = joinPath(runfilesPath, "cyberworlds/admin/sqs/local/java_path.txt");
    const javaPath = (await fs.readFile(javaPathPath, "utf8")).trim();
    assert(javaPath.startsWith("external/"));
    return joinPath(runfilesPath, javaPath.slice("external/".length));
});

const elasticmqJarPath = joinPath(runfilesPath, "elasticmq/file/elasticmq-server.jar");

export type SqsLocal = {
    readonly logsPath: string;
    readonly port: number;

    /**
     * Stop the local SQS server. If `force: true` is set then we kill the server
     * without letting it persist its state. Normally, in a clean shutdown SQS will
     * persist its state and wait for any ongoing `ReceiveMessage` requests to
     * finish. For tests, when we're done we're done. We don't want to wait on
     * `ReceiveMessage` requests.
     */
    stop(options: {force: boolean}): Promise<void>;
};

/**
 * Starts a local [AWS SQS][1] (Simple Queue Service) server. We use
 * [ElasticMQ][2] to simulate AWS SQS locally.
 *
 * [1]: https://aws.amazon.com/sqs/
 * [2]: https://github.com/softwaremill/elasticmq
 */
export async function startSqsLocal({
    dataPath,
    logsPath,
    port,
    statsPort,
}: {
    logsPath: string;
    port: number;
    statsPort: number | null;
} & (
    | {
          dataPath: string;
          withInMemoryData?: undefined;
      }
    | {
          withInMemoryData: true;
          dataPath?: undefined;
      }
)): Promise<SqsLocal> {
    const [, logFileDescriptor, javaPath] = await runAllPromises([
        dataPath !== undefined ? fs.ensureDir(dataPath) : undefined,
        fs.ensureDir(logsPath).then(() => fs.open(joinPath(logsPath, "elasticmq.log"), "a")),
        javaPathPromise.get(),
    ]);

    const configPath = joinPath(dataPath ?? logsPath, "config.conf");
    const queuesStoragePath =
        dataPath !== undefined ? joinPath(dataPath, "queues_storage.conf") : undefined;
    const messagesStoragePath =
        dataPath !== undefined ? joinPath(dataPath, "messages_storage") : undefined;

    // For whatever reason you can't bind to IPv4 localhost in a MacOS sandbox but
    // you can bind to IPv6 localhost. See:
    // https://github.com/bazelbuild/bazel/issues/5206#issuecomment-402398624
    const bindHostname = process.platform === "darwin" ? "[::1]" : "localhost";

    const awsRegion = "us-east-1";
    const awsAccountId = "local";

    /* eslint-disable string-quotes */

    const configContents = [];

    configContents.push('include classpath("application.conf")');

    configContents.push(`\
node-address {
    protocol = "http"
    host = "localhost"
    port = ${port}
    context-path = ""
}`);

    configContents.push(`\
rest-sqs {
    enabled = true
    bind-port = ${port}
    bind-hostname = "${bindHostname}"
    sqs-limits = "strict"
}`);

    if (statsPort !== null) {
        configContents.push(`\
rest-stats {
    enabled = true
    bind-port = ${statsPort}
    bind-hostname = "${bindHostname}"
}`);
    }

    configContents.push(`\
aws {
    region = "${awsRegion}"
    accountId = "${awsAccountId}"
}`);

    if (queuesStoragePath !== undefined) {
        configContents.push(`\
queues-storage {
    enabled = true
    path = "${queuesStoragePath}"
}`);
    }

    if (messagesStoragePath !== undefined) {
        configContents.push(`\
messages-storage {
    enabled = true
    uri = "jdbc:h2:${messagesStoragePath}"
}`);
    }

    /* eslint-enable string-quotes */

    await fs.writeFile(configPath, configContents.join("\n\n") + "\n");

    const subprocess = spawn(javaPath, [`-Dconfig.file=${configPath}`, "-jar", elasticmqJarPath], {
        env: {NODE_ENV: "development"},
        stdio: ["ignore", logFileDescriptor, logFileDescriptor],
    });

    await waitForProcessSpawn(subprocess);

    // Wait for ElasticMQ to start.
    await waitForHttpServer(port);

    // Immediately create SQS queues once ElasticMQ has started up.
    const client = new SQSClient({
        region: awsRegion,
        endpoint: `http://localhost:${port}`,
    });
    try {
        await runAllPromises([
            client.send(new CreateQueueCommand({QueueName: "JobDeadLetterQueue"})),
            client.send(new CreateQueueCommand({QueueName: "FileProcessorJobDeadLetterQueue"})),
        ]);

        // TODO(ifitzsimmons, #file-processor-service-migration) Remove when we migrate
        await client.send(
            new CreateQueueCommand({
                QueueName: "FileProcessorJobQueue",
                Attributes: {
                    // eslint-disable-next-line string-quotes
                    RedrivePolicy: `{"deadLetterTargetArn":"arn:aws:sqs:${awsRegion}:${awsAccountId}:FileProcessorJobDeadLetterQueue","maxReceiveCount":"5"}`,
                },
            }),
        );

        await runAllPromises([
            client.send(
                new CreateQueueCommand({
                    QueueName: "JobQueue",
                    Attributes: {
                        // eslint-disable-next-line string-quotes
                        RedrivePolicy: `{"deadLetterTargetArn":"arn:aws:sqs:${awsRegion}:${awsAccountId}:JobDeadLetterQueue","maxReceiveCount":"5"}`,
                    },
                }),
            ),
            // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): setup dedicated
            // DLQ for Heavy processor
            client.send(
                new CreateQueueCommand({
                    QueueName: "FileProcessorHeavyJobQueue",
                    Attributes: {
                        // eslint-disable-next-line string-quotes
                        RedrivePolicy: `{"deadLetterTargetArn":"arn:aws:sqs:${awsRegion}:${awsAccountId}:FileProcessorJobQueue","maxReceiveCount":"5"}`,
                    },
                }),
            ),
            // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): setup dedicated
            // DLQ for Light processor
            client.send(
                new CreateQueueCommand({
                    QueueName: "FileProcessorLightJobQueue",
                    Attributes: {
                        // eslint-disable-next-line string-quotes
                        RedrivePolicy: `{"deadLetterTargetArn":"arn:aws:sqs:${awsRegion}:${awsAccountId}:FileProcessorJobQueue","maxReceiveCount":"5"}`,
                    },
                }),
            ),
        ]);
    } finally {
        client.destroy();
    }

    return {
        logsPath,
        port,
        stop: async ({force}: {force: boolean}) => {
            try {
                if (force) {
                    subprocess.kill("SIGKILL");
                } else {
                    subprocess.kill();
                    await waitForProcessExit(subprocess);
                }
            } finally {
                await fs.close(logFileDescriptor);
            }
        },
    };
}
