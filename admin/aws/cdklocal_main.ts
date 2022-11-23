import {spawn} from "child_process";
import path from "path";
import {getProcessEnvToPropagate} from "~/admin/helpers/run_process";
import {runfilesPath} from "~/admin/helpers/runfiles_path";
import {workspacePath} from "~/admin/helpers/workspace_path";
import {localstackEdgePort} from "~/server/aws/localstack_edge_port";

const cdklocalExecutablePath = path.join(
    runfilesPath,
    "cyberworlds/node_modules/aws-cdk-local/bin/cdklocal",
);

const subprocess = spawn(cdklocalExecutablePath, process.argv.slice(2), {
    cwd: workspacePath,
    env: {
        ...getProcessEnvToPropagate(),
        LOCALSTACK_HOSTNAME: "127.0.0.1",
        EDGE_PORT: localstackEdgePort.toString(),
    },
    stdio: ["inherit", "inherit", "inherit"],
});

subprocess.on("exit", code => {
    process.exit(code ?? 1);
});
