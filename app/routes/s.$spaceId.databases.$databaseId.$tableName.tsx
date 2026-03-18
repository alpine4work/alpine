import {useParams} from "@remix-run/react";
import {DatabaseResultTable} from "~/client/web/databases/database_result_table.js";
import {useReactiveDatabaseQuery} from "~/client/web/databases/use_reactive_database_query.js";
import {Box} from "~/client/web/design/box.js";
import {sprinkles} from "~/client/web/styles/styles.js";

export default function DatabaseTableRoute() {
    const {tableName} = useParams();
    /* eslint-disable-next-line cyberworlds/string-quotes -- SQL literal */
    const result = useReactiveDatabaseQuery(`SELECT * FROM "${tableName}"`);

    if (result == null) {
        return (
            <Box fontSize="75" fontStyle="code" color="grey-50" padding="2">
                Loading...
            </Box>
        );
    }
    if (!result.ok) {
        return (
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
        );
    }
    return <DatabaseResultTable rows={result.value} />;
}
