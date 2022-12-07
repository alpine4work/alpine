import {json} from "@remix-run/cloudflare";
import {Outlet} from "@remix-run/react";
import {authorizeAccountHasInternalAccess} from "~/server/dynamo/accounts_table";
import {DataFunctionArgs} from "~/server/helpers/types/remix_data_function_args";

// The loader only performs authorization. We don't need to reload on
// page change.
export const unstable_shouldReload = () => false;

export async function loader({context}: DataFunctionArgs) {
    await authorizeAccountHasInternalAccess(context);
    return json({});
}

export default function InternalLayout() {
    return <Outlet />;
}
