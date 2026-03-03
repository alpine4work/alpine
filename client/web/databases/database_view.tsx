import {useEffect, useState} from "react";
import {databaseWorkerMethods} from "~/client/web/databases/database_worker_methods.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {sprinkles} from "~/client/web/styles/styles.js";

type DatabaseRpc = WebWorkerRpc<typeof databaseWorkerMethods>;

export function DatabaseView() {
    const [query, setQuery] = useState("");
    const [rpc, setRpc] = useState<DatabaseRpc | null>(null);
    const [rows, setRows] = useState<ReadonlyArray<unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const worker = new Worker(new URL("./database_worker.js", import.meta.url), {
            type: "module",
        });

        worker.onmessage = event => {
            if (event.data?.type === "ready") {
                const workerRpc = new WebWorkerRpc({
                    methods: databaseWorkerMethods,
                    handlers: {} as any,
                    send: message => worker.postMessage(message),
                });
                worker.onmessage = e => workerRpc.handleMessage(e.data);
                setRpc(workerRpc);
            }
        };

        return () => {
            worker.terminate();
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
            <Box display="flex">
                <Button
                    variant="neutral"
                    onPress={async () => {
                        if (rpc == null) return;
                        setError(null);
                        try {
                            const response = await rpc.call("executeQuery", {sql: query});
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
