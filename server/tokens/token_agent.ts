import {TokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {TokenAgentPublicSide} from "~/server/tokens/token_agent_public_side.js";

/**
 * The token agent class is responsible for RSA key cryptography between services
 * in our system.
 *
 * A service has only its own private key and has the public keys for every other
 * service.
 */
export type TokenAgent<PrivateSide extends TokenAgentPrivateSide = TokenAgentPrivateSide> = {
    readonly privateSide: PrivateSide;
    readonly publicSide: TokenAgentPublicSide;
};
