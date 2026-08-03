import {useContext} from "react";
import {InboxContextDefinition} from "~/client/web/inbox/context/inbox_context_definition.js";
import {InboxContext} from "~/client/web/inbox/context/inbox_context_types.js";

export function useInboxContext(): InboxContext | null {
    return useContext(InboxContextDefinition);
}
