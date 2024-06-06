import {Link, useLocation} from "@remix-run/react";
import {createPath} from "@remix-run/router";
import {Fragment, useEffect, useRef} from "react";
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {ErrorBase} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

// The same default error message is copied in
// `WebNavigationController.swift`'s `showUnhealthyAlert()` function. If we
// update the message here, we should update it there as well.
export const defaultErrorDisplayMessage = errorDisplayMessage`An unexpected error occurred, please try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}`;

const isBrowserRuntime = typeof window !== "undefined";

export function ErrorDisplayMessageRenderer({
    error,
    fontSize = "100",
    prefixMessage,
    isSingleLine,
    reportingContext,
}: {
    error: unknown;
    fontSize?: "75" | "100" | "200";

    /**
     * A message to put in front of the error display message.
     */
    prefixMessage?: string;

    /**
     * Should we render the error display message as a single sentence? Effects the
     * error code which will be rendered on the same line as the message.
     */
    isSingleLine?: boolean;

    /**
     * Context to report the rendered error in. Useful if the error was generated
     * somewhere with a different `AppContext` than where it's rendered. For
     * example, an error generated in a peek rendering in a toast.
     */
    reportingContext?: AppContext;
}) {
    const context = useAppContext();
    const location = useLocation();
    const displayMessage = error instanceof ErrorBase ? error.displayMessage : null;

    const errorToReportRef = useRef({error, hasReported: false});

    // We use a different implementation on the client and on the server. On the
    // server we want to report the error synchronously in render so it can be
    // included in the HTTP response. On the client we want to report the error in
    // an effect. Ok to break the rules of hooks here since this branch is entirely
    // environment dependent.
    if (!isBrowserRuntime) {
        // If the error prop changed, then we need to log it again.
        if (!Object.is(errorToReportRef.current.error, error)) {
            errorToReportRef.current = {error, hasReported: false};
        }

        // We report rendered errors in the React render function since we want the
        // errors to show up in our instrumentation while server-side rendering.
        // Server-side rendering doesn't run effects.
        if (!errorToReportRef.current.hasReported) {
            errorToReportRef.current.hasReported = true;
            (reportingContext ?? context).react.reportRenderedError(errorToReportRef.current.error);
        }
    } else {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useEffect(() => {
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
        }, [context, error, reportingContext]);
    }

    return (
        <Box
            color="grey-100"
            fontStyle="normal"
            fontSize={fontSize}
            style={{lineHeight: 1.5}}
            userSelect="text"
        >
            {prefixMessage && `${prefixMessage} `}
            {(displayMessage ?? defaultErrorDisplayMessage).map((displayMessageSegment, index) => {
                switch (displayMessageSegment.type) {
                    case "Text":
                    case "SensitiveText":
                        return <Fragment key={index}>{displayMessageSegment.text}</Fragment>;
                    case "Link":
                        return (
                            // TODO(calebmer): Pressed styling?
                            <FocusRing key={index}>
                                {startsWithSafeUrlProtocol(displayMessageSegment.url) ? (
                                    <a
                                        href={displayMessageSegment.url}
                                        className={contentSchemaStyles.linkClassName}
                                    >
                                        {displayMessageSegment.text}
                                    </a>
                                ) : (
                                    <Link
                                        to={
                                            displayMessageSegment.url === "/sign-in"
                                                ? // Special-case `/sign-in` URL to provide a `to` search param that will take us
                                                  // back to the URL which erred.
                                                  `${
                                                      displayMessageSegment.url
                                                  }?to=${encodeURIComponent(createPath(location))}`
                                                : displayMessageSegment.url
                                        }
                                        className={contentSchemaStyles.linkClassName}
                                    >
                                        {displayMessageSegment.text}
                                    </Link>
                                )}
                            </FocusRing>
                        );
                    default:
                        throw exhaustive(displayMessageSegment);
                }
            })}
            {!displayMessage && (
                <>
                    {isSingleLine && " "}
                    <Box
                        display={isSingleLine ? "inline" : "block"}
                        paddingTop="2"
                        color="grey-40"
                        fontSize={
                            {
                                "75": "50" as const,
                                "100": "50" as const,
                                "200": "75" as const,
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
                        {isSingleLine && "("}Error code:{" "}
                        {error instanceof ErrorBase ? error.code : ErrorCode.Unknown}
                        {isSingleLine && ")"}
                    </Box>
                </>
            )}
        </Box>
    );
}
