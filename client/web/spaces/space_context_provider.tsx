import {ReactNode, useCallback, useMemo, useState} from "react";
import {useDevConsoleTool} from "~/client/web/dev/dev_console.js";
import {
    MyAccountWebSocketContext,
    SpaceContextDefinition,
} from "~/client/web/spaces/internal/space_context_definition.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceContextProvider({
    initialSpace,
    currentAccount,
    currentAccountWithoutSpace,
    children,
}: {
    initialSpace: SpaceModel;
    currentAccount: AccountModel | null;
    currentAccountWithoutSpace: AccountModelWithoutSpace | null;
    children?: ReactNode;
}) {
    const [space, setSpace] = useState(initialSpace);

    // If the new space has a lower version than the current space then we don't
    // update the space. This is to prevent us from racing condition when a space
    // is being updated by multiple clients.
    const updateSpace = useCallback((newSpace: SpaceModel) => {
        setSpace(oldSpace => oldSpace.merge(newSpace));
    }, []);

    // If `currentAccount` exists then `currentAccountWithoutSpace` must also exist
    // for the same account.
    if (currentAccount !== null) {
        assert(currentAccount.id === currentAccountWithoutSpace?.id);
    }

    const {isConnected, subscribeToEvents, subscribeToPongs, toggleShouldConnect} = useWebSocket(
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
                () => ({space, currentAccount, currentAccountWithoutSpace, updateSpace}),
                [currentAccount, currentAccountWithoutSpace, space, updateSpace],
            )}
        >
            <MyAccountWebSocketContext.Provider
                value={useMemo(
                    () => ({isConnected, subscribeToEvents, subscribeToPongs}),
                    [isConnected, subscribeToEvents, subscribeToPongs],
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
    initialSpace,
    currentAccount,
    children,
}: {
    initialSpace: SpaceModel;
    currentAccount: AccountModel;
    children?: ReactNode;
}) {
    const [space, setSpace] = useState(initialSpace);
    assert(import.meta.jest);

    const updateSpace = useCallback((newSpace: SpaceModel) => {
        setSpace(oldSpace => (oldSpace.version >= newSpace.version ? oldSpace : newSpace));
    }, []);

    return (
        <SpaceContextDefinition.Provider
            value={useMemo(
                () => ({
                    space,
                    currentAccount,
                    currentAccountWithoutSpace: currentAccount,
                    updateSpace,
                }),
                [currentAccount, space, updateSpace],
            )}
        >
            {children}
        </SpaceContextDefinition.Provider>
    );
}
