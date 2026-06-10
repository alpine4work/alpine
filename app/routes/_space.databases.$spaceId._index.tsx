import {notFoundResponse} from "~/server/remix/not_found_response.js";

export async function loader() {
    // A database group is always addressed by a table or view id; a bare `/databases`
    // request has no target, so it's a 404.
    throw notFoundResponse();
}

export default function DatabaseGroupIndexRoute() {
    return null;
}
