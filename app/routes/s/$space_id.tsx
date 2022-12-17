import {json} from "@remix-run/cloudflare";
import {Outlet} from "@remix-run/react";
import {authorizeAccountHasSpaceAccess} from "~/server/dynamo/spaces_table";
import {DataFunctionArgs} from "~/server/helpers/types/remix_context";
import {Schema} from "~/shared/schema/schema";

// The loader only performs authorization. We don't need to reload on
// page change.
export const unstable_shouldReload = () => false;

export async function loader({context, params}: DataFunctionArgs) {
    const spaceId = Schema.id.deserialize(params.space_id ?? null);
    await authorizeAccountHasSpaceAccess(await context.auth().authenticate(), spaceId);
    return json({});
}

export default function InternalLayout() {
    return <Outlet />;
}
