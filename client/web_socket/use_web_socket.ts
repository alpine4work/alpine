import {Memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {useReporter} from "~/client/design/reporter.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";
import {WebSocketClient, WebSocketClientProcedures} from "~/client/web_socket/web_socket_client.js";
import {InternalError} from "~/shared/error/error.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {
    WebSocketProtocolBase,
    WebSocketProtocolEventType,
    WebSocketProtocolProceduresType,
} from "~/shared/web_socket/web_socket_protocol.js";

const webSocketErrorDialogKey = Symbol("webSocketError");
const webSocketErrorDialogEventEmitter = new EventEmitter();

/**
 * React hook for connecting to a WebSocket using our `WebSocketClient`
 * abstraction.
 *
 * Features:
 *
 * - Automatically attempts to reconnect the WebSocket when it closes
 *   unexpectedly.
 * - Automatically disconnects the WebSocket when the user hides the page.
 * - Type safe messages using our schema framework.
 * - Automatic heart beating so the server knows our WebSocket is still alive
 *   and we know our server is still alive.
 * - Resolves URL by replacing the `http://` protocol with `ws://` or
 *   automatically adding the domain name if you use an absolute path like
 *   `/hello/world`.
 */
export function useWebSocket<Protocol extends WebSocketProtocolBase>(
    serviceName: TracerServiceName,
    protocol: Protocol,
    url: string | null,
    handleEvent?: (message: WebSocketProtocolEventType<Protocol>) => void,
): {
    isConnected: boolean;
    procedures: MemoObject<WebSocketClientProcedures<WebSocketProtocolProceduresType<Protocol>>>;
    subscribeToEvents: Memo<
        (subscriber: (event: WebSocketProtocolEventType<Protocol>) => void) => () => void
    >;
    toggleShouldConnect: () => void;
} {
    const context = useAppContext();

    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const client = useMemo(() => {
        if (!url) return null;
        // eslint-disable-next-line react-compiler/react-compiler
        return new WebSocketClient(() => contextRef.current, serviceName, protocol, url);
    }, [protocol, serviceName, url]);

    const clientState = useStore(client?.state ?? null);

    useWebSocketErrorDialog(client, clientState);

    const [shouldConnect, setShouldConnect] = useState(true);

    useEffect(() => {
        if (!client || !shouldConnect) return;

        client.connect();
        return () => {
            void client.disconnect();
        };
    }, [client, shouldConnect]);

    const toggleShouldConnect = useCallback(() => {
        setShouldConnect(shouldConnect => !shouldConnect);
    }, []);

    // Subscribe to any messages coming from our client.
    const actuallyHandleEvent = useEvent(handleEvent);
    useEffect(() => {
        return client?.subscribeToEvents(actuallyHandleEvent);
    }, [actuallyHandleEvent, client]);

    return {
        isConnected: clientState?.isConnected ?? false,
        procedures: useMemo(() => {
            if (client) return client.procedures;
            return mapObjectValues(protocol.procedureSchemas, () => () => {
                throw new InternalError(
                    "Can’t execute procedures when passing null as the URL to `useWebSocket()`",
                );
            }) as any;
        }, [client, protocol.procedureSchemas]),
        subscribeToEvents: useCallback(
            subscriber => client?.subscribeToEvents(subscriber) ?? noop,
            [client],
        ),
        toggleShouldConnect,
    };
}

/**
 * We may have multiple WebSocket connections at once. If the user loses all
 * connections at the same time (e.g. during a deploy or if the user goes into
 * a subway tunnel) then we should only show one lost connection error message
 * to the user. This hook manages presenting that one error message to the
 * user.
 */
export function useWebSocketErrorDialog(
    client: {reconnect(): void} | null,
    errorState: {hasError: false} | {hasError: true; error: unknown} | null,
) {
    const reporter = useReporter();
    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useEffect(() => {
        // If the WebSocket in an inert route fails, don't report an error to the user
        // until the user navigates back to the route.
        if (isInertNativeMobileRoute) return;

        if (!client || !errorState?.hasError) return;

        // Only show one "Lost connection" dialog at a time. We may have multiple
        // WebSocket connections that disconnect at the same time (e.g. during a deploy
        // or if the user goes into a subway tunnel) but we should show the user only
        // one lost connection error message.
        if (reporter.hasDialogWithKey(webSocketErrorDialogKey)) {
            // If a lost connection dialog is already open, log any additional WebSocket
            // errors we have to telemetry.
            reporter.logErrorWithoutDisplaying("Additional WebSocket error", errorState.error);
        } else {
            reporter.showDialog({
                key: webSocketErrorDialogKey,
                title: "Lost connection",
                description: {
                    type: "Error",
                    error: errorState.error,
                },
                // User must explicitly press retry to close modal dialog. When the modal closes
                // we will try loading again.
                primaryButtonLabel: "Retry",
                shouldHideCancelButton: true,
                withoutCloseInteractions: true,
                onPrimaryButtonPress: () => {
                    webSocketErrorDialogEventEmitter.emit();
                },
            });
        }

        return webSocketErrorDialogEventEmitter.subscribe(() => {
            client.reconnect();
        });
    }, [client, errorState, isInertNativeMobileRoute, reporter]);
}
