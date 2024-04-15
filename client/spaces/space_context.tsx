import {Memo, ReactNode, createContext, useContext, useMemo} from "react";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {InternalError} from "~/shared/error/error.js";
import {MyAccountEvent, MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const SpaceContext = createContext<{
    readonly space: SpaceModel;
    readonly currentAccount: AccountModel;
} | null>(null);

const MyAccountWebSocket = createContext<{
    readonly isConnected: boolean;
    readonly subscribeToEvents: Memo<(subscriber: (event: MyAccountEvent) => void) => () => void>;
} | null>(null);

/**
 * Context available when we are in a space route. Throws an
 * error if we are not in a space route.
 */
export function useSpaceContext() {
    const spaceContext = useContext(SpaceContext);
    if (!spaceContext) throw new InternalError("Must be in a space route to get space context");
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
    const myAccountWebSocketContext = useContext(MyAccountWebSocket);
    if (!myAccountWebSocketContext) {
        throw new InternalError("Must be in a space route to use the `MyAccountService` WebSocket");
    }
    return myAccountWebSocketContext;
}

export function SpaceContextProvider({
    space,
    currentAccount,
    children,
}: {
    space: SpaceModel;
    currentAccount: AccountModel;
    children?: ReactNode;
}) {
    const {isConnected, subscribeToEvents, toggleShouldConnect} = useWebSocket(
        MyAccountProtocol,
        `/api/durable-objects/my-account/${currentAccount.id}`,
    );

    useDevConsoleTool("myAccount", () => ({
        id: currentAccount.id,
        toggleShouldConnect,
    }));

    return (
        <SpaceContext.Provider
            value={useMemo(() => ({space, currentAccount}), [currentAccount, space])}
        >
            <MyAccountWebSocket.Provider
                value={useMemo(
                    () => ({isConnected, subscribeToEvents}),
                    [isConnected, subscribeToEvents],
                )}
            >
                {children}
            </MyAccountWebSocket.Provider>
        </SpaceContext.Provider>
    );
}
