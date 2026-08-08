import {useSearchParams} from "@remix-run/react";
import {Box} from "~/client/web/design/box.js";
import {Link} from "~/client/web/design/link.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";

// This route is mostly used for integration tests. If you want an empty route to
// open a peek on top of, here you are!
export default function DevEmptyView() {
    if (process.env.NODE_ENV === "production") {
        throw new PermissionDeniedError(
            "Empty route is only for use in development and test environments",
        );
    }

    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const linkSearchParam = searchParams.get("link");

    return (
        <Box display="flex" flexDirection="column" gap="4" padding="6">
            {linkSearchParam && (
                <Box>
                    <Link
                        url={linkSearchParam}
                        onClick={event => {
                            event.preventDefault();
                            navigate(linkSearchParam);
                        }}
                    >
                        Link
                    </Link>
                </Box>
            )}
        </Box>
    );
}
