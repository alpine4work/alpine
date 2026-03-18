import {useEffect, useRef, useState} from "react";
import {
    type DatabaseConnection,
    type ReactiveQueryHandle,
} from "~/client/web/databases/connect_to_database.js";
import {DatabaseResultTable} from "~/client/web/databases/database_result_table.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseReactiveQueryId} from "~/shared/id/types/id_types.js";

interface WatchEntry {
    readonly id: DatabaseReactiveQueryId;
    readonly sql: string;
}

function WatchedQueryResults(props: {
    sql: string;
    handle: ReactiveQueryHandle;
    onClose: () => void;
}) {
    const result = useStore(props.handle.store);
    const [flashing, setFlashing] = useState(false);
    const isFirstRef = useRef(true);

    useEffect(() => {
        if (isFirstRef.current) {
            isFirstRef.current = false;
            return;
        }
        setFlashing(true);
        const timer = setTimeout(() => setFlashing(false), 500);
        return () => clearTimeout(timer);
    }, [result]);

    return (
        <Box
            borderRadius="1"
            boxShadow="elevation-5-with-grey-10-border"
            padding="2"
            style={{
                backgroundColor: flashing ? "#fef9c3" : undefined,
                transition: "background-color 500ms ease-out",
            }}
        >
            <Box display="flex" justifyContent="space-between" alignItems="center">
                <pre
                    className={sprinkles({
                        fontSize: "75",
                        fontStyle: "code",
                        color: "grey-60",
                    })}
                >
                    {props.sql}
                </pre>
                <Button
                    variant="quieter"
                    onPress={props.onClose}
                    pressErrorTitle="Failed to unwatch"
                >
                    Close
                </Button>
            </Box>
            {result.ok ? (
                <DatabaseResultTable rows={result.value} />
            ) : (
                <pre
                    className={sprinkles({
                        fontSize: "75",
                        fontStyle: "code",
                        color: "red-60",
                        padding: "2",
                    })}
                >
                    {result.error}
                </pre>
            )}
        </Box>
    );
}

function WatchedQueryEntry(props: {conn: DatabaseConnection; sql: string; onClose: () => void}) {
    const [handle, setHandle] = useState<ReactiveQueryHandle | null>(null);

    useEffect(() => {
        let cancelled = false;
        let h: ReactiveQueryHandle | null = null;
        (async () => {
            h = await props.conn.watchQuery(props.sql);
            if (!cancelled) setHandle(h);
        })();
        return () => {
            cancelled = true;
            h?.unwatch();
        };
    }, [props.conn, props.sql]);

    if (handle === null) {
        return (
            <Box borderRadius="1" boxShadow="elevation-5-with-grey-10-border" padding="2">
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <pre
                        className={sprinkles({
                            fontSize: "75",
                            fontStyle: "code",
                            color: "grey-60",
                        })}
                    >
                        {props.sql}
                    </pre>
                    <Button
                        variant="quieter"
                        onPress={props.onClose}
                        pressErrorTitle="Failed to unwatch"
                    >
                        Close
                    </Button>
                </Box>
                <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                    Loading...
                </Box>
            </Box>
        );
    }

    return <WatchedQueryResults sql={props.sql} handle={handle} onClose={props.onClose} />;
}

/* eslint-disable cyberworlds/string-quotes -- SQL literals, not UI text */
const sampleQueries = [
    {
        label: "Create table",
        sql: "CREATE TABLE tasks (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  status TEXT DEFAULT 'todo',\n  created_at TEXT DEFAULT (datetime('now'))\n);",
    },
    {
        label: "Insert rows",
        sql: "INSERT INTO tasks (title, status) VALUES\n  ('Design database schema', 'done'),\n  ('Build OPFS storage layer', 'in_progress'),\n  ('Add sync protocol', 'todo'),\n  ('Write documentation', 'todo');",
    },
    {label: "Select all", sql: "SELECT * FROM tasks;"},
    {label: "Filter", sql: "SELECT * FROM tasks WHERE status = 'todo';"},
    {label: "Aggregate", sql: "SELECT status, count(*) AS count FROM tasks GROUP BY status;"},
];
/* eslint-enable cyberworlds/string-quotes */

export function DatabaseSqlView({conn}: {conn: DatabaseConnection | null}) {
    const [query, setQuery] = useState("");
    const [rows, setRows] = useState<ReadonlyArray<unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [watches, setWatches] = useState<ReadonlyArray<WatchEntry>>([]);

    return (
        <>
            <textarea
                className={sprinkles({
                    display: "block",
                    width: "full",
                    fontSize: "75",
                    fontStyle: "code",
                    backgroundColor: "grey-0",
                    color: "grey-100",
                    borderRadius: "1",
                    boxShadow: "elevation-5-with-grey-10-border",
                    padding: "2",
                })}
                style={{
                    resize: "vertical",
                    minHeight: 120,
                }}
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
                placeholder="SELECT * FROM ..."
            />
            <Box display="flex" gap="2" flexWrap="wrap">
                {sampleQueries.map(sample => (
                    <Button
                        key={sample.label}
                        variant="quieter"
                        onPress={() => setQuery(sample.sql)}
                        pressErrorTitle="Failed to set query"
                    >
                        {sample.label}
                    </Button>
                ))}
            </Box>
            <Box display="flex" gap="2">
                <Button
                    variant="neutral"
                    onPress={async () => {
                        if (conn == null) return;
                        setError(null);
                        try {
                            const response = await conn.call("executeAction", {
                                action: {name: "rawSql" as const, input: {sql: query}},
                            });
                            const result = response.result as unknown as {
                                output: {rows: Array<Record<string, unknown>>};
                            };
                            setRows(result.output.rows);
                        } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                            setRows(null);
                        }
                    }}
                    pressErrorTitle="Failed to execute"
                >
                    Execute
                </Button>
                <Button
                    variant="quieter"
                    onPress={() => {
                        if (conn == null || query.trim() === "") return;
                        setWatches(prev => [
                            ...prev,
                            {id: generateId<DatabaseReactiveQueryId>(), sql: query},
                        ]);
                    }}
                    pressErrorTitle="Failed to watch query"
                >
                    Watch
                </Button>
            </Box>
            {error != null && (
                <pre
                    className={sprinkles({
                        fontSize: "75",
                        fontStyle: "code",
                        color: "red-60",
                        padding: "2",
                    })}
                >
                    {error}
                </pre>
            )}
            {rows != null && <DatabaseResultTable rows={rows} />}
            {watches.length > 0 && conn != null && (
                <Box display="flex" flexDirection="column" gap="2">
                    <Box fontSize="100" fontStyle="semi-bold">
                        Watched Queries
                    </Box>
                    {watches.map(watch => (
                        <WatchedQueryEntry
                            key={watch.id}
                            conn={conn}
                            sql={watch.sql}
                            onClose={() => {
                                setWatches(prev => prev.filter(w => w.id !== watch.id));
                            }}
                        />
                    ))}
                </Box>
            )}
        </>
    );
}
