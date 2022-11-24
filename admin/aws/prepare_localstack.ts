import chalk from "chalk";
import crypto from "crypto";
import path from "path";
import prettyMilliseconds from "pretty-ms";
import {runProcess} from "~/admin/helpers/run_process";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {localstackEdgePort} from "~/server/aws/localstack_edge_port";
import {seedDynamo} from "~/server/dynamo/seed_dynamo";

// This function runs in Node.js but we execute some code that expects to run
// in Cloudflare workers. So set the global `crypto` object to the Web
// Crypto API.
(global as any).crypto = crypto.webcrypto;

const cdklocalExecutablePath = path.join(
    runfilesPath,
    "cyberworlds/node_modules/aws-cdk-local/bin/cdklocal",
);

/**
 * Starts localstack (if its not already started) and deploys our resources using
 * the AWS CDK.
 *
 * Uses the same logging style as Next.js so developers know what's happening
 * since this can take a while.
 */
export async function prepareLocalstack() {
    await runProcess("localstack", ["start", "--detached", "--no-banner"], {
        env: {
            EDGE_PORT: localstackEdgePort.toString(),
        },
    });

    // eslint-disable-next-line no-console
    console.log(
        `☁️  LocalStack listening on ${chalk.underline(`http://localhost:${localstackEdgePort}`)}`,
    );

    const startTime = process.hrtime.bigint();

    try {
        await runProcess(cdklocalExecutablePath, ["deploy"], {
            env: {
                LOCALSTACK_HOSTNAME: "127.0.0.1",
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });
    } catch {
        // eslint-disable-next-line no-console
        console.log("☁️  Bootstrapping LocalStack environment, this may take a while...");

        await runProcess(cdklocalExecutablePath, ["bootstrap"], {
            env: {
                LOCALSTACK_HOSTNAME: "127.0.0.1",
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });

        await runProcess(cdklocalExecutablePath, ["deploy"], {
            env: {
                LOCALSTACK_HOSTNAME: "127.0.0.1",
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });
    }

    const durationMs = Number((process.hrtime.bigint() - startTime) / BigInt("1000000"));

    // eslint-disable-next-line no-console
    console.log(`☁️  Deployed AWS resources to LocalStack in ${prettyMilliseconds(durationMs)}`);

    const seedStartTime = process.hrtime.bigint();
    await seedDynamo();
    const seedDurationMs = Number((process.hrtime.bigint() - seedStartTime) / BigInt("1000000"));

    // eslint-disable-next-line no-console
    console.log(`☁️  Seeded DynamoDB with initial data in ${prettyMilliseconds(seedDurationMs)}`);
}
