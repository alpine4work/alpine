import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentJobQueueServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {BotTokenPayload} from "~/server/tokens/token_payload.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";

// Subset of `TokenAgent<TokenAgentJobQueueServicePrivateSide>`. Tests only
// need to implement this subset.
export type BotWebhookContextModuleTokenAgentInterface = {
    readonly privateSide: {
        dangerouslySignLongLivedTokenForBotWebhook(payload: BotTokenPayload): Promise<string>;
    };
};

assertAssignableTypes<
    TokenAgent<TokenAgentJobQueueServicePrivateSide>,
    BotWebhookContextModuleTokenAgentInterface
>();

/**
 * Webhook for generating tokens for bots when we call their webhook. We need
 * to create a context module since we carefully control access to `TokenAgent`
 * at the service root and selectively expose capabilities to the rest of our
 * code through context modules.
 */
export class BotWebhookContextModule extends ContextModuleBase {
    private readonly _tokenAgent: BotWebhookContextModuleTokenAgentInterface;

    constructor(tokenAgent: BotWebhookContextModuleTokenAgentInterface) {
        super();
        this._tokenAgent = tokenAgent;
    }

    public dangerouslySignLongLivedToken(payload: BotTokenPayload): Promise<string> {
        return this._tokenAgent.privateSide.dangerouslySignLongLivedTokenForBotWebhook(payload);
    }
}
