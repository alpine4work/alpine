import {json} from "@remix-run/cloudflare";
import {Outlet, ShouldReloadFunction} from "@remix-run/react";
import {authorizeAccountHasSpaceAccess} from "~/server/dynamo/spaces_table";
import {DataFunctionArgs} from "~/server/helpers/types/remix_context";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

// Run the loader again when the space ID changes.
export const unstable_shouldReload: ShouldReloadFunction = ({url, prevUrl}) =>
    url.pathname.split("/")[1] !== prevUrl.pathname.split("/")[1];

export async function loader({context, params}: DataFunctionArgs) {
    const spaceId = Schema.id.deserialize(params.space_id ?? null);
    const authenticatedContext = await context.auth().authenticate();
    await authorizeAccountHasSpaceAccess(authenticatedContext, spaceId);

    const propagateEventData: TracerEventData = {
        context: {
            account: {id: authenticatedContext.auth().getAccountId()},
            space: {id: spaceId},
        },
    };

    return json({propagateEventData});
}

export default function InternalLayout() {
    return <Outlet />;
}
