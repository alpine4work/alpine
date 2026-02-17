import {
    createFictionalAmbrookSpace,
    uploadFictionalAmbrookAvatars,
} from "~/admin/scenarios/internal/fictional_ambrook_space.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {JsonObjectValue} from "~/shared/helpers/types/json_value.js";

export async function createLandingPageScenario(
    context: TestContext,
    {tokenAgent}: {tokenAgent: TokenAgent},
) {
    const {space, accounts, cassCadeEmailAddress, roseCompasEmailAddress} =
        await createFictionalAmbrookSpace(context);

    const {cassCade, roseCompas} = accounts;

    await uploadFictionalAmbrookAvatars(tokenAgent, accounts);

    return {
        space,
        cassCade,
        log: cast<JsonObjectValue>({
            spaceId: space.id,
            cassCade: {
                accountId: cassCade.account.id,
                emailAddress: cassCadeEmailAddress,
            },
            roseCompas: {
                accountId: roseCompas.account.id,
                emailAddress: roseCompasEmailAddress,
            },
        }),
    };
}
