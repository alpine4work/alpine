import {spawn} from "child_process";
import yargs from "yargs";
import {
    localstackLogPath,
    startLocalstack,
    stopLocalstack,
} from "~/admin/aws/localstack/localstack";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";

void yargs
    .scriptName("localstack")
    .command(
        "start",
        "Start running LocalStack in a background process",
        yargs => yargs,
        () => {
            runPromiseWithoutAwaiting(async () => {
                const {started} = await startLocalstack();

                if (started) {
                    // eslint-disable-next-line no-console
                    console.log("Started LocalStack in a background process");
                } else {
                    // eslint-disable-next-line no-console
                    console.log("Already running LocalStack in a background process");
                    process.exitCode = 1;
                }
            });
        },
    )
    .command(
        "stop",
        "Stop the LocalStack background process",
        yargs => yargs,
        () => {
            runPromiseWithoutAwaiting(async () => {
                const {stopped} = await stopLocalstack();

                if (stopped) {
                    // eslint-disable-next-line no-console
                    console.log("Stopped LocalStack background process");
                } else {
                    // eslint-disable-next-line no-console
                    console.log("No running LocalStack background process");
                    process.exitCode = 1;
                }
            });
        },
    )
    .command(
        "logs",
        "Show the LocalStack logs and watch for new logs",
        yargs => yargs,
        () => {
            const subprocess = spawn("tail", ["-n", "500", "-F", localstackLogPath], {
                stdio: ["ignore", "inherit", "inherit"],
            });

            // Exit our process if/when `tail` exits.
            subprocess.on("exit", code => {
                process.exit(code ?? 1);
            });
        },
    )
    .help()
    .demandCommand()
    .parse();
