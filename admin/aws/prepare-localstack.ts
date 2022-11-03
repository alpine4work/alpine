import chalk from "chalk";
import prettyMilliseconds from "pretty-ms";
import {runProcess} from "~/admin/helpers/run-process";
import {localstackEdgePort} from "~/server/aws/localstack-edge-port";

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
        await runProcess("cdklocal", ["deploy"], {
            env: {
                LOCALSTACK_HOSTNAME: "127.0.0.1",
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });
    } catch {
        // eslint-disable-next-line no-console
        console.log("☁️  Bootstrapping LocalStack environment, this may take a while...");

        await runProcess("cdklocal", ["bootstrap"], {
            env: {
                LOCALSTACK_HOSTNAME: "127.0.0.1",
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });

        await runProcess("cdklocal", ["deploy"], {
            env: {
                LOCALSTACK_HOSTNAME: "127.0.0.1",
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });
    }

    const durationMs = Number((process.hrtime.bigint() - startTime) / BigInt("1000000"));

    // eslint-disable-next-line no-console
    console.log(`☁️  Deployed AWS resources to LocalStack in ${prettyMilliseconds(durationMs)}`);
}
