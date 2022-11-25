import {json} from "@remix-run/cloudflare";
import {Outlet} from "@remix-run/react";
import {DataFunctionArgs} from "~/server/helpers/types/remix_data_function_args";
import {NotFoundError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";

export async function loader({context: _context}: DataFunctionArgs) {
    const context = await _context.authenticate();
    const account = await context.getAccount();

    if (!account.hasInternalAccess)
        throw new NotFoundError("Account does not have internal access", {
            displayMessage: errorDisplayMessage`Only members of our team may access internal tools.`,
        });

    return json({});
}

export default function InternalLayout() {
    return <Outlet />;
}
