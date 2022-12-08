import {json} from "@remix-run/cloudflare";
import {Outlet} from "@remix-run/react";
import {authorizeAccountHasInternalAccess} from "~/server/dynamo/accounts_table";
import {DataFunctionArgs} from "~/server/helpers/types/remix_data_function_args";

export async function loader({context}: DataFunctionArgs) {
    await authorizeAccountHasInternalAccess(context);
    return json({});
}

export default function InternalLayout() {
    return <Outlet />;
}
