import {Memo, useContext} from "react";
import {
    MyAccountWebSocketContext,
    SpaceContextDefinition,
} from "~/client/spaces/internal/space_context_definition.js";
import {SpaceContext} from "~/client/spaces/space_context_types.js";
import {InternalError} from "~/shared/error/error.js";
import {MyAccountEvent} from "~/shared/notifications/my_account_protocol.js";

/**
 * Context available when we are in a space route. Throws an error if we are
 * not in a space route.
 */
export function useSpaceContext(): SpaceContext {
    const spaceContext = useContext(SpaceContextDefinition);
    if (!spaceContext) throw new InternalError("Must be in a space route to get space context");
    return spaceContext;
}

/**
 * Context available when we are in a space route. Returns null if we're not in
 * a space route.
 */
export function useSpaceContextIfExists(): SpaceContext | null {
    const spaceContext = useContext(SpaceContextDefinition);
    return spaceContext;
}

/**
 * Use the shared connection to the `MyAccountService` WebSocket anywhere in
 * the UI for a space.
 *
 * At least the notification bell needs this connection at all times. Other
 * parts of the UI may reuse the connection if useful.
 */
export function useMyAccountWebSocket(): {
    readonly isConnected: boolean;
    readonly subscribeToEvents: Memo<(subscriber: (event: MyAccountEvent) => void) => () => void>;
} {
    const myAccountWebSocketContext = useContext(MyAccountWebSocketContext);
    if (!myAccountWebSocketContext) {
        throw new InternalError("Must be in a space route to use the `MyAccountService` WebSocket");
    }
    return myAccountWebSocketContext;
}
