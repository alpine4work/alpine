import {Memo, ReactNode, createContext, useContext, useMemo} from "react";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {MyAccountEvent, MyAccountProtocol} from "~/shared/accounts/my_account_protocol";
import {InternalError} from "~/shared/error/error";
import {AccountModel} from "~/shared/models/account_model";
import {SpaceModel} from "~/shared/models/space_model";

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
export function useMyAccountWebSocket() {
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
        `/durable-objects/my-account/${currentAccount.id}`,
    );

    useDevConsoleTool("myAccount", () => ({toggleShouldConnect}));

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
