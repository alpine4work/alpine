import {useContext} from "react";
import {PeekContextDefinition} from "~/client/web/remix/internal/peek_context_definition.js";
import {PeekContext} from "~/client/web/remix/peek_context_types.js";

/**
 * Get the context of the peek we are rendering in if we are rendering in
 * a peek. If we are not rendering in a peek then this will return null.
 */
export function usePeekContext(): PeekContext | null {
    return useContext(PeekContextDefinition);
}
