import {createContext} from "react";
import {type InboxContext} from "~/client/inbox/inbox_context_types.js";

const InboxContext = createContext<InboxContext | null>(null);
export {InboxContext as InboxContextDefinition};
