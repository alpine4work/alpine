import {Memo, createContext} from "react";
import {type SpaceContext} from "~/client/spaces/space_context_types.js";
import {MyAccountEvent} from "~/shared/notifications/my_account_protocol.js";

const SpaceContext = createContext<SpaceContext | null>(null);
export {SpaceContext as SpaceContextDefinition};

export const MyAccountWebSocketContext = createContext<{
    readonly isConnected: boolean;
    readonly subscribeToEvents: Memo<(subscriber: (event: MyAccountEvent) => void) => () => void>;
} | null>(null);
