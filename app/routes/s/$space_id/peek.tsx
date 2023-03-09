import {Outlet} from "@remix-run/react";
import {InvalidArgumentError} from "~/shared/error/error";

// NOCOMMIT: Test that all `/s/$space_id/peek/*` routes have a matching
// `/s/$space_id/*` route. Since we should be able to expand peek routes to the
// full thing.

export default function PeekLayout() {
    // NOCOMMIT: Sometimes allow rendering peek...
    throw new InvalidArgumentError("Can not access peek");

    return <Outlet />;
}
