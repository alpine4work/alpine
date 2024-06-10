import {useRouteError} from "react-router";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {useStableValue} from "~/client/helpers/use_stable_value.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";
import {useRouteErrorTitle} from "~/client/spaces/layout/route_error_title.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";

export function PeekErrorBoundary() {
    // It appears that Remix does not `useMemo()` its error object. So stabilize
    // the object reference here. Our error rendering components use referential
    // identity to determine whether we need to log the error.
    const error = useStableValue(ErrorSchema, useRouteError());

    const withMobileLayout = usePeekContext()?.withMobileLayout ?? false;

    return (
        <Box display="flex" justifyContent="center" padding="safe-area-inset">
            <Box
                width="full"
                maxWidth="128"
                paddingX="8"
                paddingTop={withMobileLayout ? "16" : "32"}
                paddingBottom="8"
            >
                <ErrorBodyRenderer title={useRouteErrorTitle()} error={error} />
            </Box>
        </Box>
    );
}
