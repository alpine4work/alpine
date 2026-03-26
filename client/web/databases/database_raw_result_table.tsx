import {Box} from "~/client/web/design/box.js";

const defaultFieldWidth = 200;

/**
 * Basic read-only table for displaying raw SQL query
 * results. Infers columns from row object keys.
 */
export function DatabaseRawResultTable({rows: rawRows}: {rows: ReadonlyArray<unknown>}) {
    const rows = rawRows as ReadonlyArray<Record<string, unknown>>;

    if (rows.length === 0) {
        return (
            <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                No rows returned.
            </Box>
        );
    }

    const columns = Object.keys(rows[0]!);

    return (
        <Box overflow="auto">
            <Box display="flex">
                {columns.map(col => (
                    <Box
                        key={col}
                        backgroundColor="grey-5"
                        color="grey-80"
                        fontSize="75"
                        fontStyle="truncate-semi-bold"
                        padding="2"
                        textAlign="left"
                        borderBottom="grey-10"
                        style={{
                            width: defaultFieldWidth,
                            minWidth: defaultFieldWidth,
                            maxWidth: defaultFieldWidth,
                        }}
                    >
                        {col}
                    </Box>
                ))}
            </Box>
            {rows.map((row, i) => (
                <Box key={i} display="flex">
                    {columns.map(col => (
                        <Box
                            key={col}
                            fontSize="75"
                            fontStyle="truncate"
                            padding="2"
                            color="grey-100"
                            borderBottom="grey-10"
                            style={{
                                width: defaultFieldWidth,
                                minWidth: defaultFieldWidth,
                                maxWidth: defaultFieldWidth,
                            }}
                        >
                            {row[col] == null ? "NULL" : String(row[col])}
                        </Box>
                    ))}
                </Box>
            ))}
        </Box>
    );
}
