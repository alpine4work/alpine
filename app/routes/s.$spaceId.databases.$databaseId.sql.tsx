import {useEffect, useMemo, useRef, useState} from "react";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {DatabaseRawResultTable} from "~/client/web/databases/database_raw_result_table.js";
import {useReactiveDatabaseAction} from "~/client/web/databases/use_reactive_database_action.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseReactiveActionId} from "~/shared/id/types/id_types.js";

interface WatchEntry {
    readonly id: DatabaseReactiveActionId;
    readonly sql: string;
}

function WatchedQuery(props: {sql: string; onClose: () => void}) {
    const result = useReactiveDatabaseAction({
        name: "readonlyRawSql",
        input: useMemo(() => ({sql: props.sql}), [props.sql]),
    });
    const [flashing, setFlashing] = useState(false);
    const isFirstRef = useRef(true);

    useEffect(() => {
        if (result == null) return;
        if (isFirstRef.current) {
            isFirstRef.current = false;
            return;
        }
        setFlashing(true);
        const timer = setTimeout(() => setFlashing(false), 500);
        return () => clearTimeout(timer);
    }, [result]);

    const rows = result?.ok ? result.value.rows : null;

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
            {result == null ? (
                <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                    Loading...
                </Box>
            ) : result.ok ? (
                <DatabaseRawResultTable rows={rows!} />
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

export default function DatabaseSqlRoute() {
    const conn = useDatabaseConnection();
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
                            const result = await conn.executeAction("rawSql", {sql: query});
                            setRows(result.rows);
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
                            {id: generateId<DatabaseReactiveActionId>(), sql: query},
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
            {rows != null && <DatabaseRawResultTable rows={rows} />}
            {watches.length > 0 && (
                <Box display="flex" flexDirection="column" gap="2">
                    <Box fontSize="100" fontStyle="semi-bold">
                        Watched Queries
                    </Box>
                    {watches.map(watch => (
                        <WatchedQuery
                            key={watch.id}
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
