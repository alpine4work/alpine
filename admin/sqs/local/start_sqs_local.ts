import {spawn} from "child_process";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {runfilesPath} from "~/admin/helpers/runfiles_path.js";
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
    dataPath: string;
    logsPath: string;
    port: number;
    statsPort: number;
}) {
    const [, logFileDescriptor, javaPath] = await runAllPromises([
        fs.ensureDir(dataPath),
        fs.ensureDir(logsPath).then(() => fs.open(joinPath(logsPath, "elasticmq.log"), "a")),
        javaPathPromise.get(),
    ]);

    const configPath = joinPath(dataPath, "config.conf");
    const queuesStoragePath = joinPath(dataPath, "queues_storage.conf");
    const messagesStoragePath = joinPath(dataPath, "messages_storage");

    let configContents = `\
include classpath("application.conf")

node-address {
    protocol = "http"
    host = "localhost"
    port = ${port}
    context-path = ""
}

rest-sqs {
    enabled = true
    bind-port = ${port}
    bind-hostname = "localhost"
    sqs-limits = "strict"
}

rest-stats {
    enabled = true
    bind-port = ${statsPort}
    bind-hostname = "localhost"
}

aws {
    region = "us-east-1"
    accountId = "local"
}

queues-storage {
    enabled = true
    path = "${queuesStoragePath}"
}

messages-storage {
    enabled = true
    uri = "jdbc:h2:${messagesStoragePath}"
}

queues {
    JobDeadLetterQueue {}

    JobQueue {
        deadLettersQueue {
            name = "JobDeadLetterQueue"
            maxReceiveCount = 3
        }
    }
}
`;

    await fs.writeFile(configPath, configContents);

    const subprocess = spawn(javaPath, [`-Dconfig.file=${configPath}`, "-jar", elasticmqJarPath], {
        env: {NODE_ENV: "development"},
        stdio: ["ignore", logFileDescriptor, logFileDescriptor],
    });

    await waitForProcessSpawn(subprocess);

    // Wait for ElasticMQ to start.
    await waitForHttpServer(port);

    return {
        port,
        stop: async () => {
            try {
                subprocess.kill();
                await waitForProcessExit(subprocess);
            } finally {
                await fs.close(logFileDescriptor);
            }
        },
    };
}
