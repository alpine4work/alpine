/* eslint-disable no-console */

import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import {
    runDevAgentsD1ApplyCommand,
    runDevAgentsD1ExecuteCommand,
    runDevAgentsD1GenerateCommand,
    runDevAgentsD1ResetCommand,
    runDevAgentsD1StatusCommand,
} from "~/admin/dev/agents_d1/dev_agents_d1_commands.js";

main()
    .then(() => {
        process.exit(0);
    })
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

async function main(): Promise<void> {
    await yargs(hideBin(process.argv))
        .scriptName("dev agents")
        .command("d1", "Manage D1 database for agents", yargs => {
            return yargs
                .command(
                    "execute <command>",
                    "Execute a D1 query command",
                    {
                        command: {
                            describe: "SQL command to execute",
                            type: "string",
                            demandOption: true,
                        },
                    },
                    async args => {
                        await runDevAgentsD1ExecuteCommand(args);
                    },
                )
                .command(
                    "apply",
                    "Apply pending migrations",
                    yargs => yargs,
                    async () => {
                        await runDevAgentsD1ApplyCommand();
                    },
                )
                .command(
                    "generate <name>",
                    "Generate a new migration with the given name",
                    {
                        name: {
                            describe: "Name for the migration",
                            type: "string",
                            demandOption: true,
                        },
                        custom: {
                            describe: "Generate an empty migration file",
                            type: "boolean",
                            default: false,
                        },
                    },
                    async args => {
                        await runDevAgentsD1GenerateCommand(args);
                    },
                )
                .command(
                    "status",
                    "Check migration status",
                    yargs => yargs,
                    async () => {
                        await runDevAgentsD1StatusCommand();
                    },
                )
                .command(
                    "reset",
                    "Drop all tables to completely reset the D1 database",
                    yargs => yargs,
                    async () => {
                        await runDevAgentsD1ResetCommand();
                    },
                )
                .demandCommand(1, "Must provide a d1 subcommand");
        })
        .strict()
        .version(false)
        .demandCommand(1, "Must provide a command")
        .fail((message, error, yargs) => {
            if (!error) {
                yargs.showHelp();
                console.error();
                console.error(message);
            } else {
                console.error(`${error.name}: ${error.message}`);
            }
            process.exit(1);
        })
        .parse();
}
