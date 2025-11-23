import {ReactElement} from "react";
import {Box} from "~/client/web/design/box.js";
import {ErrorDisplayMessageRenderer} from "~/client/web/design/error_display_message_renderer.js";
import {ErrorIcon} from "~/client/web/design/error_icon.js";
import {fontSizes, sprinkles} from "~/client/web/styles/styles.js";
import {invertColor} from "~/shared/design/core/inverted_colors.js";
import {ErrorBase} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";

/**
 * Renders an error with a title at body content size.
 */
export function ErrorBodyRenderer({
    icon = null,
    title,
    error,
    colorSchemeOverride,
}: {
    icon?: ReactElement | null;
    title: string;
    error: unknown;
    // Override the color scheme. If undefined then we'll use whatever the current
    // color scheme is.
    colorSchemeOverride?: "dark" | "light";
}) {
    const errorIcon =
        icon ??
        // If this is not a system error and has a display message (e.g.
        // `PermissionDeniedError`) then we don't show the red warning icon. Since this
        // error is probably expected.
        ((!(error instanceof ErrorBase) || isSystemError(error) || !error.displayMessage) && (
            <ErrorIcon size="100%" />
        ));

    const titleColor = "grey-100";

    return (
        <>
            <Box
                display="flex"
                gap="2"
                paddingBottom="2.5"
                color={
                    colorSchemeOverride === "light"
                        ? `${titleColor}-const`
                        : colorSchemeOverride === "dark"
                        ? `${invertColor(titleColor)}-const`
                        : titleColor
                }
            >
                {errorIcon && (
                    <Box
                        flexShrink="0"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
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
                            {errorIcon}
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
            <ErrorDisplayMessageRenderer
                error={error}
                fontSize="200"
                color="grey-80"
                colorSchemeOverride={colorSchemeOverride}
            />
        </>
    );
}
