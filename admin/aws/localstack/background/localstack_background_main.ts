import {spawn} from "child_process";
import isPortReachable from "is-port-reachable";
import path from "path";
import stripAnsi from "strip-ansi";
import {getProcessEnvToPropagate} from "~/admin/helpers/run_process";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit";
import {workspacePath} from "~/admin/helpers/workspace_path";
import {localstackEdgePort} from "~/server/aws/localstack_edge_port";
import {InternalError} from "~/shared/error/error";
import {wait} from "~/shared/helpers/async/wait";

// Name the process so we can easily find it in a process list.
process.title = "localstack_background";

const localstackExecutablePath = path.join(
    runfilesPath,
    "cyberworlds/admin/aws/localstack/background/localstack_cli",
);

const cdklocalExecutablePath = path.join(
    runfilesPath,
    "cyberworlds/node_modules/aws-cdk-local/bin/cdklocal",
);

const localstackSubprocess = spawn(localstackExecutablePath, ["start", "--host"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
        EDGE_PORT: localstackEdgePort.toString(),
    },
});

// Exit our process if/when LocalStack exits.
localstackSubprocess.on("exit", code => {
    process.exit(code ?? 1);
});

async function run() {
    let attempts = 0;
    while (!(await isPortReachable(localstackEdgePort, {host: "127.0.0.1"}))) {
        await wait(100);
        attempts++;

        if (attempts >= 100) throw new InternalError("Timed out waiting for LocalStack to start");
    }

    {
        const bootstrapSubprocess = spawn(cdklocalExecutablePath, ["bootstrap"], {
            stdio: ["ignore", "pipe", "pipe"],
            cwd: workspacePath,
            env: {
                ...getProcessEnvToPropagate(),
                LOCALSTACK_HOSTNAME: "127.0.0.1",
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });

        bootstrapSubprocess.stdout.on("data", chunk => {
            process.stdout.write(stripAnsi(chunk.toString("utf8")));
        });

        bootstrapSubprocess.stderr.on("data", chunk => {
            process.stderr.write(stripAnsi(chunk.toString("utf8")));
        });

        await waitForProcessExit(bootstrapSubprocess);
    }

    {
        const deploySubprocess = spawn(cdklocalExecutablePath, ["deploy"], {
            stdio: ["ignore", "pipe", "pipe"],
            cwd: workspacePath,
            env: {
                ...getProcessEnvToPropagate(),
                LOCALSTACK_HOSTNAME: "127.0.0.1",
                EDGE_PORT: localstackEdgePort.toString(),
            },
        });

        deploySubprocess.stdout.on("data", chunk => {
            process.stdout.write(stripAnsi(chunk.toString("utf8")));
        });

        deploySubprocess.stderr.on("data", chunk => {
            process.stderr.write(stripAnsi(chunk.toString("utf8")));
        });

        await waitForProcessExit(deploySubprocess);
    }
}

run().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);

    localstackSubprocess.kill();
    process.exit(1);
});
