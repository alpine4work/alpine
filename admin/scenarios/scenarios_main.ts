import "~/server/helpers/node/register_noop_react_refresh.js";

import * as inquirer from "@inquirer/prompts";
import chalk from "chalk";
import {inspect} from "util";
import {withDevelopmentEnvironment} from "~/admin/environment/development/with_development_environment.js";
import {createLaunchVideoScenario} from "~/admin/scenarios/launch_video_scenario.js";
import {createMockAgentPlaygroundScenario} from "~/admin/scenarios/mock_agent_playground_scenario.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {JsonObjectValue} from "~/shared/helpers/types/json_value.js";

type ScenarioFunction = (
    context: TestContext,
    options: {tokenAgent: TokenAgent},
) => Promise<{log: JsonObjectValue}>;

const allScenarios: Record<string, ScenarioFunction> = {
    LaunchVideo: createLaunchVideoScenario,
    MockAgentPlayground: createMockAgentPlaygroundScenario,
};

async function main() {
    await withDevelopmentEnvironment(async (context, options) => {
        const scenarioNameArg = process.argv[2] ?? "";

        let scenarioName: string;
        let createScenario: ScenarioFunction;

        if (scenarioNameArg.length > 0) {
            const createScenarioArg = allScenarios[scenarioNameArg];

            if (!createScenarioArg) {
                throw new NotFoundError(quote`Scenario ${scenarioNameArg} not found`);
            }

            scenarioName = scenarioNameArg;
            createScenario = createScenarioArg;
        } else {
            ({scenarioName, createScenario} = await inquirer.select({
                message: "Which scenario would you like to create?",
                choices: Object.entries(allScenarios).map(([scenarioName, createScenario]) => ({
                    name: scenarioName,
                    value: {scenarioName, createScenario},
                })),
            }));
        }

        const output = await context.tracer
            .getTracer()
            .withSpan(`Create ${scenarioName} scenario`, async span => {
                const contextWithSpan = context.cloneWithHelpers({
                    tracer: new TracerContextModule(span),
                });

                return createScenario(contextWithSpan, options);
            });

        // eslint-disable-next-line no-console
        console.log(
            inspect(output.log, {
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
        // Immediately exit once `main()` finishes. Don't wait for any pending timeouts
        // keeping the process alive. `withDevContext()` will wait for all
        // `waitUntil()` calls to complete before resolving.
        process.exit(0);
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);

        // Immediately exit once `main()` finishes. Don't wait for any pending timeouts
        // keeping the process alive. `withDevContext()` will wait for all
        // `waitUntil()` calls to complete before resolving.
        process.exit(1);
    },
);
