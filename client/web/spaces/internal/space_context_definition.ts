import {Memo, createContext} from "react";
import {type SpaceContext} from "~/client/web/spaces/space_context_types.js";
import {MyAccountEvent} from "~/shared/notifications/my_account_protocol.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

const SpaceContext = createContext<SpaceContext | null>(null);
export {SpaceContext as SpaceContextDefinition};

export const MyAccountWebSocketContext = createContext<{
    readonly isConnected: boolean;
    readonly subscribeToEvents: Memo<(subscriber: (event: MyAccountEvent) => void) => () => void>;
    readonly subscribeToPongs: Memo<
        (subscriber: (message: WebSocketPongMessage) => void) => () => void
    >;
} | null>(null);
