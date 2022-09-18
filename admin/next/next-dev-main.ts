import chalk from "chalk";
import {createServer} from "http";
import next from "next";
import prettyMilliseconds from "pretty-ms";
import {repoDirectoryPath} from "~/server/helpers/repo-directory-path";
import {runProcess} from "~/server/helpers/run-process";
import {assert} from "~/shared/helpers/control/assert";

assert(process.cwd() === repoDirectoryPath);
assert(process.env.NODE_ENV === "development");

// An array of cleanup functions to call when shutting down our
// development server.
const cleanupListeners: Array<() => Promise<void>> = [];

assert(process.env.HOST);
assert(process.env.PORT);

const host = process.env.HOST;
const port = parseInt(process.env.PORT, 10);

const app = next({dev: true, hostname: host, port});
const handle = app.getRequestHandler();

async function prepare() {
    await Promise.all([app.prepare(), prepareLocalstack()]);
}

let isPrepared = false;
const preparePromise = prepare();
preparePromise.then(
    () => {
        isPrepared = true;
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);

        // Run all our cleanup functions before
        Promise.allSettled(
            cleanupListeners.map(cleanup =>
                cleanup().catch(error => {
                    // eslint-disable-next-line no-console
                    console.error(error);
                }),
            ),
        ).then(() => {
            process.exit(1);
        });
    },
);

const server = createServer((req, res) => {
    if (isPrepared) {
        handle(req, res);
    } else {
        preparePromise.then(() => handle(req, res));
    }
});
cleanupListeners.push(async () => {
    server.close();
});

server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`${chalk.green("ready")} - started server on http://${host}:${port}`);
});

async function prepareLocalstack() {
    await runProcess("localstack", ["start", "--detached", "--no-banner"], {});

    // eslint-disable-next-line no-console
    console.log(`${chalk.cyan("info")}  - localstack ready on http://localhost:4566`);

    const startTime = process.hrtime.bigint();

    try {
        await runProcess("cdklocal", ["deploy"], {});
    } catch {
        // eslint-disable-next-line no-console
        console.log(
            `${chalk.magenta(
                "event",
            )} - bootstrapping localstack environment, this may take a while...`,
        );

        await runProcess("cdklocal", ["bootstrap"], {});

        await runProcess("cdklocal", ["deploy"], {});
    }

    const durationMs = Number((process.hrtime.bigint() - startTime) / BigInt("1000000"));

    // eslint-disable-next-line no-console
    console.log(
        `${chalk.magenta("event")} - deployed aws resources to localstack in ${prettyMilliseconds(
            durationMs,
        )}`,
    );
}
