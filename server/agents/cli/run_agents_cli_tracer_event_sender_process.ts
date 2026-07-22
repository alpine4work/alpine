import {createInterface as createReadlineInterface} from "readline";
import {runAgentsCliTracerEventSenderProcess} from "~/server/agents/cli/create_agents_cli_tracer_event_sender.js";

const [baseUrlString = "", dataDirectoryPath = ""] = process.argv.slice(2);
process.stdin.setEncoding("utf8");

runAgentsCliTracerEventSenderProcess({
    baseUrl: new URL(baseUrlString),
    dataDirectoryPath,
    messages: createReadlineInterface({input: process.stdin}),
}).then(
    () => process.exit(0),
    () => process.exit(0),
);
