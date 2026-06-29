import {useEffect, useRef, useState} from "react";
import type {DatabaseReactiveActionHandle} from "~/client/web/databases/connect_to_database.js";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {useStableJsonValue} from "~/client/web/helpers/use_stable_json_value.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import type {
    DatabaseActionInput,
    DatabaseActionName,
    DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import type {LoaderDatabaseActionResult} from "~/shared/databases/database_protocol_schemas.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import type {Result} from "~/shared/helpers/control/result.js";
import type {JsonStringifiableValue} from "~/shared/helpers/types/json_value.js";

/**
 * Subscribes to a reactive (watched) action on the current database connection.
 * Returns `null` while the action is being set up, then a result that auto-updates
 * whenever the underlying data changes.
 *
 * Pass `null` for `input` to skip the subscription. When `initialData` is provided
 * and its action name and input match the current subscription (deep equality),
 * the initial output is returned while the reactive subscription boots up.
 */
export function useReactiveDatabaseAction<N extends DatabaseActionName>(options: {
    name: N;
    input: DatabaseActionInput<N> | null;
    initialData?: LoaderDatabaseActionResult | null;
}): Result<DatabaseActionOutput<N>, string> | null {
    const {name, input, initialData} = options;
    const stableInput = useStableJsonValue(
        input as JsonStringifiableValue | null,
    ) as DatabaseActionInput<N> | null;
    const conn = useDatabaseConnection();
    const [handle, setHandle] = useState<DatabaseReactiveActionHandle<N> | null>(null);
    const initialDataRef = useRef(initialData);

    useEffect(() => {
        if (stableInput == null) return;

        const readPages = initialDataRef.current?.readPages;
        if (readPages !== undefined && readPages.size > 0) {
            void conn.call("writeInitialPages", {pages: readPages});
        }

        let cancelled = false;
        let h: DatabaseReactiveActionHandle<N> | null = null;
        void (async () => {
            h = await conn.watchAction(name, stableInput);
            if (!cancelled) setHandle(h);
        })();
        return () => {
            cancelled = true;
            h?.unwatch();
            setHandle(null);
        };
    }, [conn, name, stableInput]);

    const reactiveResult = useStore(handle?.store ?? null);

    if (reactiveResult != null) {
        if (!reactiveResult.ok) return reactiveResult;
        return {ok: true, value: reactiveResult.value as DatabaseActionOutput<N>};
    }
    if (
        initialData != null &&
        stableInput != null &&
        initialData.name === name &&
        isDeepEqual(initialData.input, stableInput)
    ) {
        return {ok: true, value: initialData.output as DatabaseActionOutput<N>};
    }
    return null;
}
