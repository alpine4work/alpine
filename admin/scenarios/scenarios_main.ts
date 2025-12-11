import "~/server/helpers/node/register_noop_react_refresh.js";

import * as inquirer from "@inquirer/prompts";
import chalk from "chalk";
import {inspect} from "util";
import {withDevContext} from "~/admin/dev/helpers/with_dev_context.js";
import {createLaunchVideoScenario} from "~/admin/scenarios/launch_video_scenario.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {NotFoundError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {JsonObjectValue} from "~/shared/helpers/types/json_value.js";

type ScenarioFunction = (
    context: TestContext,
    options: {tokenAgent: TokenAgent},
) => Promise<JsonObjectValue>;

const allScenarios: Record<string, ScenarioFunction> = {
    LaunchVideo: createLaunchVideoScenario,
};

async function main() {
    await withDevContext(async (context, options) => {
        const scenarioNameArg = process.argv[2] ?? "";

        let createScenario: ScenarioFunction;

        if (scenarioNameArg.length > 0) {
            const createScenarioArg = allScenarios[scenarioNameArg];

            if (!createScenarioArg) {
                throw new NotFoundError(quote`Scenario ${scenarioNameArg} not found`);
            }

            createScenario = createScenarioArg;
        } else {
            createScenario = await inquirer.select({
                message: "Which scenario would you like to create?",
                choices: Object.entries(allScenarios).map(([scenarioName, createScenario]) => ({
                    name: scenarioName,
                    value: createScenario,
                })),
            });
        }

        const output = await createScenario(context, options);

        // eslint-disable-next-line no-console
        console.log(
            inspect(output, {
                depth: Infinity,
                colors: !!chalk.supportsColor,
                // Split objects onto new lines even if they're below the break length.
                compact: false,
            }),
        );
    });
}

main().then(
    () => {
        process.exitCode = 0;
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    },
);
