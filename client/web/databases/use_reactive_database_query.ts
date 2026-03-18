import {useEffect, useState} from "react";
import type {
    ReactiveQueryHandle,
    ReactiveQueryResult,
} from "~/client/web/databases/connect_to_database.js";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {useStore} from "~/client/web/helpers/use_store.js";

/**
 * Subscribes to a reactive (watched) query on the current
 * database connection. Returns `null` while the query is
 * being set up, then a {@link ReactiveQueryResult} that
 * auto-updates whenever the underlying data changes.
 *
 * Pass `null` for `sql` to skip the query.
 */
export function useReactiveDatabaseQuery(sql: string | null): ReactiveQueryResult | null {
    const conn = useDatabaseConnection();
    const [handle, setHandle] = useState<ReactiveQueryHandle | null>(null);

    useEffect(() => {
        if (conn == null || sql == null) return;
        let cancelled = false;
        let h: ReactiveQueryHandle | null = null;
        (async () => {
            h = await conn.watchQuery(sql);
            if (!cancelled) setHandle(h);
        })();
        return () => {
            cancelled = true;
            h?.unwatch();
            setHandle(null);
        };
    }, [conn, sql]);

    return useStore(handle?.store ?? null);
}
