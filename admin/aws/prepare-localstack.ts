import chalk from "chalk";
import prettyMilliseconds from "pretty-ms";
import {runProcess} from "~/server/helpers/run-process";
import {assert} from "~/shared/helpers/control/assert";

assert(process.env.LOCALSTACK_EDGE_PORT);
const localstackEdgePort = parseInt(process.env.LOCALSTACK_EDGE_PORT, 10);

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
        `${chalk.cyan("info")}  - localstack ready on http://localhost:${localstackEdgePort}`,
    );

    const startTime = process.hrtime.bigint();

    try {
        await runProcess("cdklocal", ["deploy"], {
            env: {
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });
    } catch {
        // eslint-disable-next-line no-console
        console.log(
            `${chalk.magenta(
                "event",
            )} - bootstrapping localstack environment, this may take a while...`,
        );

        await runProcess("cdklocal", ["bootstrap"], {
            env: {
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });

        await runProcess("cdklocal", ["deploy"], {
            env: {
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });
    }

    const durationMs = Number((process.hrtime.bigint() - startTime) / BigInt("1000000"));

    // eslint-disable-next-line no-console
    console.log(
        `${chalk.magenta("event")} - deployed aws resources to localstack in ${prettyMilliseconds(
            durationMs,
        )}`,
    );
}
