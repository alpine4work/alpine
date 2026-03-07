import {useEffect, useRef, useState} from "react";
import {useParams} from "react-router";
import {
    type DatabaseConnection,
    type ReactiveQueryHandle,
    connectToDatabase,
} from "~/client/web/databases/database_coordinator.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {
    type DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseMutationId, DatabaseReactiveQueryId} from "~/shared/id/types/id_types.js";

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

function TableView({rows}: {rows: ReadonlyArray<unknown>}) {
    if (rows.length === 0) {
        return (
            <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                No rows returned.
            </Box>
        );
    }
    const columns = Object.keys(rows[0] as Record<string, unknown>);
    return (
        <Box
            overflow="auto"
            borderRadius="1"
            boxShadow="elevation-5-with-grey-10-border"
            style={{maxHeight: 400}}
        >
            <table
                className={sprinkles({
                    width: "full",
                    fontSize: "75",
                    fontStyle: "code",
                })}
                style={{borderCollapse: "collapse"}}
            >
                <thead>
                    <tr>
                        {columns.map(col => (
                            <th
                                key={col}
                                className={sprinkles({
                                    backgroundColor: "grey-5",
                                    color: "grey-80",
                                    padding: "2",
                                })}
                                style={{
                                    textAlign: "left",
                                    borderBottom: "1px solid var(--grey-10)",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {col}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => {
                        const record = row as Record<string, unknown>;
                        return (
                            <tr key={i}>
                                {columns.map(col => (
                                    <td
                                        key={col}
                                        className={sprinkles({
                                            padding: "2",
                                            color: "grey-100",
                                        })}
                                        style={{
                                            borderBottom: "1px solid var(--grey-10)",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {record[col] == null ? "NULL" : String(record[col])}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </Box>
    );
}

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
    const prevCountRef = useRef(result.invalidationCount);

    useEffect(() => {
        if (result.invalidationCount > prevCountRef.current) {
            prevCountRef.current = result.invalidationCount;
            setFlashing(true);
            const timer = setTimeout(() => setFlashing(false), 500);
            return () => clearTimeout(timer);
        }
    }, [result.invalidationCount]);

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
            {result.error != null ? (
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
            ) : (
                <TableView rows={result.rows} />
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

export function DatabaseView() {
    const {spaceId} = useParams();
    const reporter = useReporter();
    const [query, setQuery] = useState("");
    const [conn, setConn] = useState<DatabaseConnection | null>(null);
    const [rows, setRows] = useState<ReadonlyArray<unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [watches, setWatches] = useState<ReadonlyArray<WatchEntry>>([]);

    const events = useEvents({
        handleEvent: (event: DatabaseRealtimeEvent) => {
            if (event.type === "PagesChanged" && conn !== null) {
                conn.call("writePagesFromRealtime", {
                    pages: event.pages,
                    mutationId: event.mutationId,
                });
            }
        },
    });

    const wsUrl = spaceId ? `/api/durable-objects/databases/${spaceId}` : null;

    const {procedures} = useWebSocket(
        "DatabaseService",
        DatabaseRealtimeProtocol,
        wsUrl,
        events.handleEvent,
    );

    const {executeServer, reportError} = useEvents({
        executeServer: async (
            sql: string,
            options: {allowWrites: boolean; mutationId: DatabaseMutationId},
        ) => {
            return procedures.execute({
                sql,
                allowWrites: options.allowWrites,
                mutationId: options.mutationId,
            });
        },
        reportError: (message: string) => {
            reporter.displayError("Couldn\u2019t save changes", new InternalError(message));
        },
    });

    useEffect(() => {
        let connection: DatabaseConnection | null = null;
        (async () => {
            connection = await connectToDatabase({executeServer, reportError});
            setConn(connection);
        })();
        return () => {
            connection?.close();
        };
    }, [executeServer, reportError]);

    return (
        <Box
            flexGrow="1"
            width="full"
            height="full"
            overflow="hidden"
            display="flex"
            flexDirection="column"
            gap="3"
            padding="4"
        >
            <Box fontSize="200" fontStyle="semi-bold">
                Database
            </Box>
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
                            const response = await conn.call("execute", {sql: query});
                            setRows(response.rows);
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
            {rows != null && <TableView rows={rows} />}
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
        </Box>
    );
}
