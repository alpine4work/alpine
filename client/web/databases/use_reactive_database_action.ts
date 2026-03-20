import {useEffect, useState} from "react";
import type {ReactiveActionHandle} from "~/client/web/databases/connect_to_database.js";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import type {
    DatabaseActionInput,
    DatabaseActionName,
    DatabaseActionObject,
    DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import type {LoaderDatabaseQueryResult} from "~/shared/databases/database_query_schema.js";
import type {Result} from "~/shared/helpers/control/result.js";

/**
 * Subscribes to a reactive (watched) action on the
 * current database connection. Returns `null` while the
 * action is being set up, then a result that auto-updates
 * whenever the underlying data changes.
 *
 * Pass `null` for `input` to skip the subscription.
 * When `initialData` is provided and its `sql` matches
 * the current `readonlyRawSql` action's input, the
 * initial rows are returned while the reactive
 * subscription boots up.
 */
export function useReactiveDatabaseAction<N extends DatabaseActionName>(options: {
    name: N;
    input: DatabaseActionInput<N> | null;
    initialData?: LoaderDatabaseQueryResult | null;
}): Result<DatabaseActionOutput<N>, string> | null {
    const {name, input, initialData} = options;
    const conn = useDatabaseConnection();
    const [handle, setHandle] = useState<ReactiveActionHandle | null>(null);

    useEffect(() => {
        if (conn == null || input == null) return;
        let cancelled = false;
        let h: ReactiveActionHandle | null = null;
        (async () => {
            h = await conn.watchAction({name, input} as DatabaseActionObject);
            if (!cancelled) setHandle(h);
        })();
        return () => {
            cancelled = true;
            h?.unwatch();
            setHandle(null);
        };
    }, [conn, name, input]);

    const reactiveResult = useStore(handle?.store ?? null);

    if (reactiveResult != null) {
        if (!reactiveResult.ok) return reactiveResult;
        return {ok: true, value: reactiveResult.value as DatabaseActionOutput<N>};
    }
    if (
        initialData != null &&
        input != null &&
        name === "readonlyRawSql" &&
        initialData.sql === (input as {sql: string}).sql
    ) {
        return {ok: true, value: {rows: initialData.rows} as DatabaseActionOutput<N>};
    }
    return null;
}
