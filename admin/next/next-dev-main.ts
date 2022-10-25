import chalk from "chalk";
import {createServer} from "http";
import next from "next";
import {prepareLocalstack} from "~/admin/aws/prepare-localstack";
import {repoDirectoryPath} from "~/server/helpers/repo-directory-path";
import {runAllPromises} from "~/shared/helpers/async/run-all-promises";
import {assert} from "~/shared/helpers/control/assert";

assert(process.cwd() === repoDirectoryPath);
assert(process.env.NODE_ENV === "development");

assert(process.env.APP_PORT);
const port = parseInt(process.env.APP_PORT, 10);

const app = next({dev: true, port});
const handle = app.getRequestHandler();

let isPrepared = false;
const preparePromise = runAllPromises([app.prepare(), prepareLocalstack()]);
preparePromise.then(
    () => {
        isPrepared = true;
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        server.close();
        process.exit(1);
    },
);

const server = createServer((req, res) => {
    if (isPrepared) {
        void handle(req, res);
    } else {
        void preparePromise.then(() => handle(req, res));
    }
});

server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`${chalk.green("ready")} - started server on http://localhost:${port}`);
});
