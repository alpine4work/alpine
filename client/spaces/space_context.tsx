import {Memo, useContext} from "react";
import {
    MyAccountWebSocketContext,
    SpaceContextDefinition,
} from "~/client/spaces/internal/space_context_definition.js";
import {SpaceContext} from "~/client/spaces/space_context_types.js";
import {unauthenticatedErrorDisplayMessage} from "~/shared/error/common_error_display_messages.js";
import {InternalError, PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {MyAccountEvent} from "~/shared/notifications/my_account_protocol.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {spaceAccessPermissionDeniedErrorDisplayMessage} from "~/shared/spaces/space_error_messages.js";

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
 * Context available when we are in a space route. Throws an error if we're not
 * in a space route and throws an error if `currentAccount` doesn't have space
 * access. This function will always return a non-null `currentAccount`.
 *
 * Generally prefer `useSpaceContext()` which returns a null `currentAccount`.
 * It's not the client's responsibility to authorize whether the account has
 * space access or not. That's the backend's responsibility. The client should
 * generally be written in a way that supports null `currentAccount`s so we can
 * enable URL sharing. For example, documents need to render with a null
 * `currentAccount` when `accessPolicy.urlGrant` is non-null.
 */
export function useSpaceContextAndRequireSpaceAccess(): Replace<
    SpaceContext,
    {currentAccount: AccountModel}
> {
    const spaceContext = useContext(SpaceContextDefinition);
    if (!spaceContext) throw new InternalError("Must be in a space route to get space context");

    // If `currentAccount` is null it's either because there's no user signed in or
    // the user that's signed in doesn't have space access. Throw a different error
    // in each case.
    if (spaceContext.currentAccount === null) {
        if (spaceContext.currentAccountWithoutSpace === null) {
            throw new UnauthenticatedError("Expected current account in space context to exist", {
                displayMessage: unauthenticatedErrorDisplayMessage,
            });
        } else {
            throw new PermissionDeniedError(
                "Expected current account in space context to have space access",
                {displayMessage: spaceAccessPermissionDeniedErrorDisplayMessage},
            );
        }
    }

    return spaceContext as any;
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
