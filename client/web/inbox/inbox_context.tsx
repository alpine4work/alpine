import {useContext} from "react";
import {InboxContext} from "~/client/web/inbox/inbox_context_types.js";
import {InboxContextDefinition} from "~/client/web/inbox/internal/inbox_context_definition.js";

export function useInboxContext(): InboxContext | null {
    return useContext(InboxContextDefinition);
}
