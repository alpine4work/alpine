import {useRouteError} from "react-router";
import {Box} from "~/client/web/design/box.js";
import {ErrorBodyRenderer} from "~/client/web/design/error_body_renderer.js";
import {useStableValue} from "~/client/web/helpers/use_stable_value.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useRouteErrorTitle} from "~/client/web/spaces/route_metadata.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";

export function PeekErrorBoundary() {
    // It appears that Remix does not `useMemo()` its error object. So stabilize the
    // object reference here. Our error rendering components use referential identity
    // to determine whether we need to log the error.
    const error = useStableValue(ErrorSchema, useRouteError());

    const routeLayout = useRouteLayout();

    return (
        <Box display="flex" justifyContent="center" padding="safe-area-inset">
            <Box
                width="full"
                maxWidth="128"
                paddingX="8"
                paddingTop={routeLayout === "narrow" ? "16" : "32"}
                paddingBottom="8"
            >
                <ErrorBodyRenderer title={useRouteErrorTitle()} error={error} />
            </Box>
        </Box>
    );
}
