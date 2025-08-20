import {Outlet} from "@remix-run/react";
import {json} from "@remix-run/router";
import {authorizeInternalAccess} from "~/server/accounts/accounts_actions.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

// The loader only performs authorization. We don't need to reload on
// page change.
export const shouldRevalidate = () => false;

export async function loader({context}: LoaderArgs) {
    await authorizeInternalAccess(await context.actor.authenticate());
    return json({});
}

export default function InternalLayout() {
    return <Outlet />;
}
