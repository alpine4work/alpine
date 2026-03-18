import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";

export function DatabaseResultTable({rows}: {rows: ReadonlyArray<unknown>}) {
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
