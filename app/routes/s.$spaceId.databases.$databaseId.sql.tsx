import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {DatabaseSqlView} from "~/client/web/databases/database_sql_view.js";

export default function DatabaseSqlRoute() {
    return <DatabaseSqlView conn={useDatabaseConnection()} />;
}
