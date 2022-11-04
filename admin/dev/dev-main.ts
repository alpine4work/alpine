import chalk from "chalk";
import http from "http";
import {buildBazelTarget} from "~/admin/dev/build-bazel-target";
import {assert} from "~/shared/helpers/control/assert";

assert(process.env.NODE_ENV === "development");

const host = "127.0.0.1";
const prettyHost = host === "127.0.0.1" ? "localhost" : host;
const port = 3000;

// Initial build
buildBazelTarget("//:remix_app").catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
});

const server = http.createServer((request, response) => {
    buildBazelTarget("//:remix_app").then(
        () => {
            response.writeHead(200, {"Content-Type": "text/plain"});
            response.end("Hello, world");
        },
        error => {
            // eslint-disable-next-line no-console
            console.error(error);

            response.writeHead(500, {"Content-Type": "text/plain"});
            response.end(http.STATUS_CODES[response.statusCode]);
        },
    );
});

server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`Devserver listening on ${chalk.underline.bold(`http://${prettyHost}:${port}`)}`);
});
