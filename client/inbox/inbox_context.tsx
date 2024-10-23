import {useContext} from "react";
import {InboxContext} from "~/client/inbox/inbox_context_types.js";
import {InboxContextDefinition} from "~/client/inbox/internal/inbox_context_definition.js";

export function useInboxContext(): InboxContext | null {
    return useContext(InboxContextDefinition);
}
