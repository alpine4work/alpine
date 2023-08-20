import {Memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {WebSocketClient, WebSocketClientProcedures} from "~/client/web_socket/web_socket_client.js";
import {InternalError} from "~/shared/error/error.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {
    WebSocketProtocolBase,
    WebSocketProtocolEventType,
    WebSocketProtocolProceduresType,
} from "~/shared/web_socket/web_socket_protocol.js";

type MemoObject<Value> = Memo<{
    [Key in keyof Value]: Memo<Value[Key]>;
}>;

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
        return new WebSocketClient(() => contextRef.current, protocol, url);
    }, [protocol, url]);

    const clientState = useStore(client?.state ?? null);

    // TODO(calebmer): This should probably be an interrupting error modal with a
    // retry button instead of a component crash.
    if (clientState?.hasError) throw clientState.error;

    const [shouldConnect, setShouldConnect] = useState(true);

    useEffect(() => {
        if (!client || !shouldConnect) return;

        client.connect();
        return () => client.disconnect();
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
                    "Can't execute procedures when passing null as the URL to `useWebSocket()`",
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
