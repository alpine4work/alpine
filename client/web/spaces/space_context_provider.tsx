import {ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {
    MyAccountWebSocketContext,
    SpaceContextDefinition,
} from "~/client/web/spaces/internal/space_context_definition.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {
    AccountSettings,
    AccountSettingsAction,
    applyAccountSettingsAction,
    initialAccountSettings,
} from "~/shared/accounts/accounts_settings.js";
import {ContextBatcher} from "~/shared/context/batch_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {voidSafeFloatingPromise} from "~/shared/helpers/async/void_safe_floating_promise.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MyAccountProtocol} from "~/shared/notifications/my_account_protocol.js";
import {updateOurAccountSettings} from "~/shared/rpc/accounts_rpc_definitions.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const UpdateOurAccountSettingsBatcher = new ContextBatcher<
    {rpc: RpcContextModuleBase},
    AccountSettingsAction,
    null
>(
    {
        whenActorChanges: "SafelyReset",
    },
    async (context, actions) => {
        await updateOurAccountSettings(context, {actions});
        return createArrayWithLength(actions.length, () => null);
    },
);

export function SpaceContextProvider({
    initialSpace,
    currentAccount,
    currentAccountWithoutSpace,
    initialSettings,
    withMyAccountWebSocket,
    children,
}: {
    initialSpace: SpaceModel;
    currentAccount: AccountModel | null;
    currentAccountWithoutSpace: AccountModelWithoutSpace | null;
    initialSettings: AccountSettings | null;
    withMyAccountWebSocket: boolean;
    children?: ReactNode;
}) {
    const context = useAppContext();
    const clientInfo = useClientInfo();
    const isInitialAppRender = useIsInitialAppRender();

    const [space, setSpace] = useState(initialSpace);

    // If the new space has a lower version than the current space then we don't update
    // the space. This is to prevent us from racing condition when a space is being
    // updated by multiple clients.
    const updateSpace = useCallback((newSpace: SpaceModel) => {
        setSpace(oldSpace => oldSpace.merge(newSpace));
    }, []);

    // If `currentAccount` exists then `currentAccountWithoutSpace` must also exist for
    // the same account.
    if (currentAccount !== null) {
        assert(currentAccount.id === currentAccountWithoutSpace?.id);
    }

    const {isConnected, subscribeToEvents, subscribeToPongs, toggleShouldConnect} = useWebSocket(
        "MyAccountService",
        MyAccountProtocol,
        withMyAccountWebSocket && currentAccount !== null
            ? `/api/durable-objects/my-account/${currentAccount.id}`
            : null,
    );

    const hasCurrentAccountWithoutSpace = currentAccountWithoutSpace !== null;

    const [currentAccountSettings, , actuallyUpdateCurrentAccountSettingsOptimistically] =
        useStateWithOptimisticUpdates(initialSettings ?? initialAccountSettings);

    const updateCurrentAccountSettings = useCallback(
        (action: AccountSettingsAction): SafeFloatingPromise<unknown> => {
            if (!hasCurrentAccountWithoutSpace) {
                throw new PermissionDeniedError(
                    "Can\u2019t update account settings for anonymous account",
                );
            }

            const promise = context.batch.execute(UpdateOurAccountSettingsBatcher, action);

            actuallyUpdateCurrentAccountSettingsOptimistically(promise, settings =>
                applyAccountSettingsAction(settings, action),
            );

            // Awaiting the promise is optional since we optimistically apply the state. We
            // don't handle errors in this function. If we need to report an error to the user
            // then you must await this promise and handle the error yourself. Otherwise
            // failures are silent.
            return promise as SafeFloatingPromise<unknown>;
        },
        [
            actuallyUpdateCurrentAccountSettingsOptimistically,
            context,
            hasCurrentAccountWithoutSpace,
        ],
    );

    const lastOpenedSpaceIdRef = useRef<SpaceId | null>(null);
    useEffect(() => {
        // Wait until after initial app render so we make this update in the same batch as
        // our observed time zone update.
        if (isInitialAppRender) return;

        if (lastOpenedSpaceIdRef.current === space.id) return;
        lastOpenedSpaceIdRef.current = space.id;

        // Only update `lastOpenedSpaceId` if the account has access to the space
        if (currentAccount === null) return;

        updateCurrentAccountSettings({
            type: "UpdateLastOpenedSpaceId",
            spaceId: space.id,
        });
    }, [context, space.id, currentAccount, updateCurrentAccountSettings, isInitialAppRender]);

    const observedTimeZoneRef = useRef<TimeZone | null>(null);
    useEffect(() => {
        // `clientInfo` updates during initial app render to the true client values
        // (instead of what was available on the server in a cookie). So don't update the
        // observed time zone until after initial app render.
        if (isInitialAppRender) return;

        if (observedTimeZoneRef.current === clientInfo.timeZone) return;
        observedTimeZoneRef.current = clientInfo.timeZone;

        // Only update `observedTimeZone` if this isn't an anonymous account.
        if (currentAccountWithoutSpace === null) return;

        updateCurrentAccountSettings({
            type: "UpdateObservedTimeZone",
            timeZone: clientInfo.timeZone,
        });
    }, [
        clientInfo.timeZone,
        context,
        currentAccountWithoutSpace,
        isInitialAppRender,
        updateCurrentAccountSettings,
    ]);

    useDevConsoleTool("myAccount", () => ({
        id: currentAccount?.id ?? currentAccountWithoutSpace?.id ?? null,
        toggleShouldConnect,
        settings: currentAccountSettings,
        resetOnboarding: () => {
            updateCurrentAccountSettings({type: "ResetOnboardingForDev"});
        },
    }));

    return (
        <SpaceContextDefinition.Provider
            value={useMemo(
                () => ({
                    space,
                    currentAccount,
                    currentAccountWithoutSpace,
                    currentAccountSettings,
                    updateCurrentAccountSettings,
                    updateSpace,
                }),
                [
                    currentAccount,
                    currentAccountSettings,
                    currentAccountWithoutSpace,
                    space,
                    updateCurrentAccountSettings,
                    updateSpace,
                ],
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
 * Space context provider for use in tests. Only provides space context. Does not
 * connect to my account WebSocket or manage any other space state.
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
                    currentAccountSettings: initialAccountSettings,
                    updateCurrentAccountSettings: () => voidSafeFloatingPromise,
                    updateSpace,
                }),
                [currentAccount, space, updateSpace],
            )}
        >
            {children}
        </SpaceContextDefinition.Provider>
    );
}
