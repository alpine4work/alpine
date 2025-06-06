import {PermissionDeniedError} from "~/shared/error/error.js";

// This route is mostly used for integration tests. If you want an empty route
// to open a peek on top of, here you are!
export default function DevEmptyView() {
    if (process.env.NODE_ENV === "production") {
        throw new PermissionDeniedError(
            "Empty route is only for use in development and test environments",
        );
    }

    return null;
}
