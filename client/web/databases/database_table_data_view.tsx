import {useEffect, useState} from "react";
import type {DatabaseConnection} from "~/client/web/databases/connect_to_database.js";
import {DatabaseResultTable} from "~/client/web/databases/database_result_table.js";
import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";

export function DatabaseTableDataView({
    conn,
    tableName,
}: {
    conn: DatabaseConnection | null;
    tableName: string;
}) {
    const [rows, setRows] = useState<ReadonlyArray<unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (conn == null) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setRows(null);
        (async () => {
            try {
                /* eslint-disable-next-line cyberworlds/string-quotes -- SQL literal */
                const sql = `SELECT * FROM "${tableName}"`;
                const response = await conn.call("executeAction", {
                    action: {name: "rawSql" as const, input: {sql}},
                });
                if (cancelled) return;
                const result = response.result as unknown as {
                    output: {rows: Array<Record<string, unknown>>};
                };
                setRows(result.output.rows);
            } catch (e) {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [conn, tableName]);

    if (loading) {
        return (
            <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                Loading...
            </Box>
        );
    }
    if (error != null) {
        return (
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
        );
    }
    if (rows != null) {
        return <DatabaseResultTable rows={rows} />;
    }
    return null;
}
