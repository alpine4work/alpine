import {Outlet, ShouldReloadFunction} from "@remix-run/react";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({});

// Run the loader again when the space ID changes.
export const unstable_shouldReload: ShouldReloadFunction = ({url, prevUrl}) =>
    url.pathname.split("/")[1] !== prevUrl.pathname.split("/")[1];

export async function loader({context, params}: LoaderArgs) {
    const spaceId = Schema.id.deserialize(params.space_id ?? null);
    const authenticatedContext = await context.auth.authenticate();
    await authorizeSpaceAccess(authenticatedContext, spaceId);

    const propagateEventData: TracerEventData = {
        context: {
            accountId: authenticatedContext.auth.getAccountId(),
            spaceId,
        },
    };

    return jsonWithSchema(LoaderSchema, {}, {propagateEventData});
}

export default function InternalLayout() {
    return <Outlet />;
}
