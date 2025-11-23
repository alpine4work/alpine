import {useMemo} from "react";
import {isRouteErrorResponse, useRouteError} from "react-router";
import {notFoundErrorDisplayMessage} from "~/app/helpers/not_found_error_display_message.js";
import {Box} from "~/client/web/design/box.js";
import {ErrorBodyRenderer} from "~/client/web/design/error_body_renderer.js";
import {useStableValue} from "~/client/web/helpers/use_stable_value.js";
import {useRouteErrorTitle} from "~/client/web/spaces/route_metadata.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {FailedPreconditionError, NotFoundError, UnknownError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {quote} from "~/shared/helpers/string/quote.js";

export function RootErrorBoundary() {
    const defaultTitle = useRouteErrorTitle();

    // It appears that Remix does not `useMemo()` its error object. So stabilize
    // the object reference here. Our error rendering components use referential
    // identity to determine whether we need to log the error.
    const routeError = useStableValue(ErrorSchema, useRouteError());

    const error = useMemo(() => {
        if (!routeError) return undefined;

        if (isRouteErrorResponse(routeError)) {
            if (routeError.status === 404) {
                return new NotFoundError("Route not found", {
                    displayMessage: notFoundErrorDisplayMessage,
                });
            }

            if (routeError.status === 405) {
                return new FailedPreconditionError("Method not allowed");
            }

            return new UnknownError(
                quote`Response thrown with status ${routeError.status} ${routeError.statusText}`,
            );
        }

        return routeError;
    }, [routeError]);

    return (
        <Box display="flex" justifyContent="center" padding="safe-area-inset">
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "128",
                    paddingX: "8",
                    paddingY: {desktop: "32", mobile: "20"},
                })}
            >
                <ErrorBodyRenderer
                    title={
                        isRouteErrorResponse(routeError) && routeError.status === 404
                            ? "Couldn’t find page"
                            : defaultTitle
                    }
                    error={error}
                />
            </main>
        </Box>
    );
}
