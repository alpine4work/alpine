import {createContext} from "react";
import {PeekContext} from "~/client/remix/peek_context_types.js";

const PeekContext = createContext<PeekContext | null>(null);
export {PeekContext as PeekContextDefinition};
