import {useEffect, useState} from "react";
import {
    type DatabaseConnection,
    connectToDatabase,
} from "~/client/web/databases/database_coordinator.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {sprinkles} from "~/client/web/styles/styles.js";

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

export function DatabaseView() {
    const [query, setQuery] = useState("");
    const [conn, setConn] = useState<DatabaseConnection | null>(null);
    const [rows, setRows] = useState<ReadonlyArray<unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let connection: DatabaseConnection | null = null;

        connectToDatabase().then(c => {
            connection = c;
            setConn(c);
        });

        return () => {
            connection?.close();
        };
    }, []);

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
            <Box display="flex">
                <Button
                    variant="neutral"
                    onPress={async () => {
                        if (conn == null) return;
                        setError(null);
                        try {
                            const response = await conn.call("executeQuery", {sql: query});
                            setRows(response.rows);
                        } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                            setRows(null);
                        }
                    }}
                    pressErrorTitle="Failed to run query"
                >
                    Run
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
            {rows != null && (
                <pre
                    className={sprinkles({
                        fontSize: "75",
                        fontStyle: "code",
                        backgroundColor: "grey-0",
                        color: "grey-100",
                        borderRadius: "1",
                        boxShadow: "elevation-5-with-grey-10-border",
                        padding: "2",
                        overflow: "auto",
                    })}
                >
                    {JSON.stringify(rows, null, 2)}
                </pre>
            )}
        </Box>
    );
}
