import {useParams} from "@remix-run/react";
import {useDatabaseConnection} from "~/client/web/databases/database_connection_context.js";
import {DatabaseTableDataView} from "~/client/web/databases/database_table_data_view.js";

export default function DatabaseTableRoute() {
    const {tableName} = useParams();
    return <DatabaseTableDataView conn={useDatabaseConnection()} tableName={tableName!} />;
}
