import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {DatabaseView} from "~/client/web/databases/database_view.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({});

export const meta = createMetaFunction(LoaderSchema, () => [{title: "Database"}]);

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    deserializeSpaceIdForLoader(params.spaceId);

    return jsonWithSchema(LoaderSchema, {});
}

export default function DatabaseRoute() {
    return <DatabaseView />;
}
