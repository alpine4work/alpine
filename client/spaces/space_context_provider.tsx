import {ReactNode, useMemo} from "react";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {
    MyAccountWebSocketContext,
    SpaceContextDefinition,
} from "~/client/spaces/internal/space_context_definition.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceContextProvider({
    space,
    currentAccount,
    currentAccountWithoutSpace,
    children,
}: {
    space: SpaceModel;
    currentAccount: AccountModel | null;
    currentAccountWithoutSpace: AccountModelWithoutSpace | null;
    children?: ReactNode;
}) {
    // If `currentAccount` exists then `currentAccountWithoutSpace` must also exist
    // for the same account.
    if (currentAccount !== null) {
        assert(currentAccount.id === currentAccountWithoutSpace?.id);
    }

    const {isConnected, subscribeToEvents, toggleShouldConnect} = useWebSocket(
        "MyAccountService",
        MyAccountProtocol,
        currentAccount !== null ? `/api/durable-objects/my-account/${currentAccount.id}` : null,
    );

    useDevConsoleTool("myAccount", () => ({
        id: currentAccount?.id ?? currentAccountWithoutSpace?.id ?? null,
        toggleShouldConnect,
    }));

    return (
        <SpaceContextDefinition.Provider
            value={useMemo(
                () => ({space, currentAccount, currentAccountWithoutSpace}),
                [currentAccount, currentAccountWithoutSpace, space],
            )}
        >
            <MyAccountWebSocketContext.Provider
                value={useMemo(
                    () => ({isConnected, subscribeToEvents}),
                    [isConnected, subscribeToEvents],
                )}
            >
                {children}
            </MyAccountWebSocketContext.Provider>
        </SpaceContextDefinition.Provider>
    );
}

/**
 * Space context provider for use in tests. Only provides space context. Does
 * not connect to my account WebSocket or manage any other space state.
 */
export function TestSpaceContextProvider({
    space,
    currentAccount,
    children,
}: {
    space: SpaceModel;
    currentAccount: AccountModel;
    children?: ReactNode;
}) {
    assert(import.meta.jest);

    return (
        <SpaceContextDefinition.Provider
            value={useMemo(
                () => ({space, currentAccount, currentAccountWithoutSpace: currentAccount}),
                [currentAccount, space],
            )}
        >
            {children}
        </SpaceContextDefinition.Provider>
    );
}
