import {useLocation} from "@remix-run/react";
import {createPath} from "@remix-run/router";
import {Fragment, ReactNode, useEffect, useRef} from "react";
import {AppContext, useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Link} from "~/client/web/design/link.js";
import {withoutErrorDisplayMessageRendererReporting} from "~/client/web/design/without_error_display_message_renderer_reporting.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {Color} from "~/shared/design/core/colors.js";
import {invertColor} from "~/shared/design/core/inverted_colors.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {ErrorBase, getErrorCode} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {getErrorOriginalTracerSpan} from "~/shared/error/error_original_tracer_span.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";

const isBrowserRuntime = typeof window !== "undefined";

export function ErrorDisplayMessageRenderer({
    error,
    fontSize = "100",
    prefixMessage,
    isSingleLine,
    color = "grey-100",
    colorSchemeOverride,
    reportingContext,
}: {
    error: unknown;
    fontSize?: "75" | "100" | "200";

    /**
     * A message to put in front of the error display message.
     */
    prefixMessage?: ReactNode;

    /**
     * Should we render the error display message as a single sentence? Effects the
     * error code which will be rendered on the same line as the message.
     */
    isSingleLine?: boolean;

    /**
     * What's the color of text for this error message? Defaults to `grey-100`.
     */
    color?: Color & (`grey-${number}` | `red-${number}`);

    /**
     * Override the color scheme. If undefined then we'll use whatever the current
     * color scheme is.
     */
    colorSchemeOverride?: "light" | "dark";

    /**
     * Context to report the rendered error in. Useful if the error was generated
     * somewhere with a different `AppContext` than where it's rendered. For
     * example, an error generated in a peek rendering in a toast.
     */
    reportingContext?: AppContext;
}) {
    const context = useAppContext();
    const location = useLocation();
    const navigate = useNavigate();

    const displayMessage = error instanceof ErrorBase ? error.displayMessage : undefined;

    const withoutReporting: boolean =
        isObject(error) && error[withoutErrorDisplayMessageRendererReporting] === true;

    const errorToReportRef = useRef({error, hasReported: false});

    // We use a different implementation on the client and on the server. On the
    // server we want to report the error synchronously in render so it can be
    // included in the HTTP response. On the client we want to report the error in
    // an effect. Ok to break the rules of hooks here since this branch is entirely
    // environment dependent.
    if (!isBrowserRuntime) {
        if (!withoutReporting) {
            // If the error prop changed, then we need to log it again.
            if (!Object.is(errorToReportRef.current.error, error)) {
                errorToReportRef.current = {error, hasReported: false};
            }

            // We report rendered errors in the React render function since we want the
            // errors to show up in our instrumentation while server-side rendering.
            // Server-side rendering doesn't run effects.
            if (!errorToReportRef.current.hasReported) {
                errorToReportRef.current.hasReported = true;
                (reportingContext ?? context).react.reportRenderedError(
                    errorToReportRef.current.error,
                );
            }
        }
    } else {
        // eslint-disable-next-line react-compiler/react-compiler
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useEffect(() => {
            if (!withoutReporting) {
                // If the error prop changed, then we need to log it again.
                if (!Object.is(errorToReportRef.current.error, error)) {
                    errorToReportRef.current = {error, hasReported: false};
                }

                if (!errorToReportRef.current.hasReported) {
                    errorToReportRef.current.hasReported = true;
                    (reportingContext ?? context).react.reportRenderedError(
                        errorToReportRef.current.error,
                    );
                }
            }
        }, [context, error, reportingContext, withoutReporting]);
    }

    const debugColor = "grey-30";

    return (
        <Box
            color={
                colorSchemeOverride === "light"
                    ? `${color}-const`
                    : colorSchemeOverride === "dark"
                      ? `${invertColor(color)}-const`
                      : color
            }
            fontStyle="normal"
            fontSize={fontSize}
            style={{lineHeight: 1.5}}
            userSelect="text"
        >
            {prefixMessage && <>{prefixMessage} </>}
            {(displayMessage ?? defaultErrorDisplayMessage).map((displayMessageSegment, index) => {
                switch (displayMessageSegment.type) {
                    // Split error message text into individual words and let any long words wrap
                    // onto multiple lines. For example, a long email address that overflows the
                    // current line.
                    case "Text":
                    case "SensitiveText": {
                        return (
                            <Fragment key={index}>
                                {displayMessageSegment.text
                                    .split(/(\p{White_Space}+)/u)
                                    .map((string, index) => {
                                        if (string.length <= 20) {
                                            return <Fragment key={index}>{string}</Fragment>;
                                        } else {
                                            return (
                                                <span key={index} style={{wordBreak: "break-word"}}>
                                                    {string}
                                                </span>
                                            );
                                        }
                                    })}
                            </Fragment>
                        );
                    }
                    case "Link": {
                        return (
                            <Link
                                key={index}
                                url={
                                    displayMessageSegment.url === errorDisplayMessage.signInLink.url
                                        ? // Special-case `/auth/sign-in` URL to provide a `to` search param that will take us
                                          // back to the URL which erred.
                                          `${displayMessageSegment.url}?to=${encodeURIComponent(
                                              createPath(location),
                                          )}`
                                        : displayMessageSegment.url
                                }
                                onClick={event => {
                                    if (NativeMobileBridge) {
                                        // Special-case `/sign-out` so if we're in the native mobile app we'll trigger
                                        // an app sign out.
                                        if (
                                            displayMessageSegment.url ===
                                            errorDisplayMessage.signOutLink.url
                                        ) {
                                            event.preventDefault();
                                            NativeMobileBridge.session.signOut();
                                        }

                                        // Special-case `/switch-space` so if we're in the native mobile app we'll open
                                        // the switch space route in app instead of in an external web browser.
                                        if (
                                            displayMessageSegment.url ===
                                            errorDisplayMessage.switchSpaceLink.url
                                        ) {
                                            event.preventDefault();
                                            navigate("/switch-space");
                                        }
                                    }
                                }}
                                colorSchemeOverride={colorSchemeOverride}
                            >
                                {displayMessageSegment.text}
                            </Link>
                        );
                    }
                    default:
                        throw exhaustive(displayMessageSegment);
                }
            })}
            {!displayMessage && (
                <>
                    {isSingleLine && " "}
                    <Box
                        display={isSingleLine ? "inline" : "block"}
                        paddingTop={!isSingleLine ? "2.5" : undefined}
                        color={
                            colorSchemeOverride === "light"
                                ? `${debugColor}-const`
                                : colorSchemeOverride === "dark"
                                  ? `${invertColor(debugColor)}-const`
                                  : debugColor
                        }
                        fontSize={
                            {
                                "75": "25" as const,
                                "100": "25" as const,
                                "200": "50" as const,
                            }[fontSize]
                        }
                        style={{
                            // HACK(calebmer): This text uses an inaccessible color. We are ok with this
                            // since the content is meant for developers, not for end users. In fact, end
                            // users should ignore this text! But we want the text to be included in error
                            // message screenshots.
                            //
                            // By setting a background image Axe ignores the inaccessible text color
                            // because it can't figure out the background color.
                            backgroundImage: "linear-gradient(rgb(0 0 0 / 0), rgb(0 0 0 / 0))",
                        }}
                    >
                        {isSingleLine && "("}Error&nbsp;code:&nbsp;{getErrorCode(error)}
                        {!isSingleLine &&
                            (() => {
                                const originalTracerSpan = getErrorOriginalTracerSpan(error);
                                if (!originalTracerSpan) return;

                                return (
                                    <>
                                        , trace:&nbsp;
                                        <span
                                            style={{
                                                // eslint-disable-next-line cyberworlds/string-quotes
                                                fontFeatureSettings: '"calt" off',
                                            }}
                                        >
                                            {originalTracerSpan.traceId}
                                        </span>
                                    </>
                                );
                            })()}
                        {isSingleLine && ")"}
                    </Box>
                </>
            )}
        </Box>
    );
}
