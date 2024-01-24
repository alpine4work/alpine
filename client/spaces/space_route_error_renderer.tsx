import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {useStableValue} from "~/client/helpers/use_stable_value.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {sprinkles} from "~/shared/styles/styles.js";

export function SpaceRouteErrorRenderer({error: _error}: {error: unknown}) {
    // It appears that Remix does not `useMemo()` its error object. So stabilize
    // the object reference here. Our error rendering components use referential
    // identity to determine whether we need to log the error.
    const error = useStableValue(ErrorSchema, _error);

    return (
        <Box
            display="flex"
            justifyContent="center"
            style={{
                paddingTop: "var(--safe-area-inset-top, 0px)",
                paddingBottom: "var(--safe-area-inset-bottom, 0px)",
                paddingLeft: "var(--safe-area-inset-left, 0px)",
                paddingRight: "var(--safe-area-inset-right, 0px)",
            }}
        >
            <Box
                className={sprinkles({
                    width: "full",
                    maxWidth: "128",
                    paddingX: "8",
                    paddingY: {desktop: "32", mobile: "16"},
                })}
            >
                <ErrorBodyRenderer
                    // TODO(calebmer): "Couldn't show content" is way too generic. Can I write a
                    // route pattern matcher so we can be more specific like "Couldn't open task"
                    // or "Couldn't open document" for initial page loads. Ideally we'd have a more
                    // specific error if the error was thrown after page load like "Task broke" or
                    // something but I don't know what that message is.
                    title="Couldn’t show content"
                    error={error}
                />
            </Box>
        </Box>
    );
}
