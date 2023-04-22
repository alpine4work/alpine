import {json} from "@remix-run/cloudflare";
import {Outlet} from "@remix-run/react";
import {authorizeInternalAccess} from "~/server/dynamo/accounts_table";
import {LoaderArgs} from "~/server/remix/loader_context";

// The loader only performs authorization. We don't need to reload on
// page change.
export const unstable_shouldReload = () => false;

export async function loader({context}: LoaderArgs) {
    await authorizeInternalAccess(await context.actor.authenticate());
    return json({});
}

export default function InternalLayout() {
    return <Outlet />;
}
