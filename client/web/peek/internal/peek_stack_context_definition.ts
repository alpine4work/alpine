import {createContext} from "react";
import {type PeekStackContext} from "~/client/web/peek/peek_stack_context_types.js";

const PeekStackContext = createContext<PeekStackContext | null>(null);
export {PeekStackContext as PeekStackContextDefinition};
