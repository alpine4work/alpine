import {Box} from "~/client/design/box.js";
import {ErrorDisplayMessageRenderer} from "~/client/design/error_display_message_renderer.js";
import {ErrorIcon} from "~/client/design/error_icon.js";
import {ErrorBase} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {fontSizes, sprinkles} from "~/shared/styles/styles.js";

/**
 * Renders an error with a title at body content size.
 */
// TODO(calebmer): This error rendered is so lame. Come up with a
// better design.
export function ErrorBodyRenderer({title, error}: {title: string; error: unknown}) {
    // If this is not a system error and has a display message (e.g.
    // `PermissionDeniedError`) then we don't show the red warning icon. Since this
    // error is probably expected.
    const dontShowErrorIcon =
        error instanceof ErrorBase && !isSystemError(error) && !!error.displayMessage;

    return (
        <>
            <Box display="flex" gap="2" paddingBottom="2.5">
                {!dontShowErrorIcon && (
                    <Box
                        position="relative"
                        flexShrink="0"
                        color="red-40"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            // Vertically align error icon with title.
                            top: "0.0625rem",
                            fontSize: fontSizes["400"].fontSize,
                            height: fontSizes["400"].lineHeight,
                        }}
                    >
                        <div
                            style={{
                                width: fontSizes["400"].fontSize,
                                height: fontSizes["400"].fontSize,
                            }}
                        >
                            <ErrorIcon size="100%" />
                        </div>
                    </Box>
                )}
                <h1
                    className={sprinkles({
                        flexGrow: "1",
                        fontSize: "400",
                        fontStyle: "semi-bold",
                        userSelect: "text",
                    })}
                >
                    {title}
                </h1>
            </Box>
            <ErrorDisplayMessageRenderer error={error} fontSize="200" />
        </>
    );
}
