import {Link} from "@remix-run/react";
import {Fragment, useRef} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {ErrorBase} from "~/shared/error/error";
import {ErrorCode} from "~/shared/error/error_code";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol";
import {contentSchemaStyles} from "~/shared/styles/styles";

const defaultErrorDisplayMessage = errorDisplayMessage`An unexpected error occurred. Please try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;

export function ErrorDisplayMessageRenderer({
    error,
    fontSize = "100",
}: {
    error: unknown;
    fontSize?: "100" | "200";
}) {
    const context = useAppContext();
    const displayMessage = error instanceof ErrorBase ? error.displayMessage : null;

    const errorToReportRef = useRef({error, hasReported: false});

    // If the error prop changed, then we need to log it again.
    if (!Object.is(errorToReportRef.current.error, error)) {
        errorToReportRef.current = {error, hasReported: false};
    }

    // We report rendered errors in the React render function since we want the
    // errors to show up in our instrumentation while server-side rendering.
    // Server-side rendering doesn't run effects.
    if (!errorToReportRef.current.hasReported) {
        errorToReportRef.current.hasReported = true;
        context.react.reportRenderedError(errorToReportRef.current.error);
    }

    return (
        <Box color="grey-80" fontStyle="normal" fontSize={fontSize} style={{lineHeight: 1.5}}>
            {(displayMessage ?? defaultErrorDisplayMessage).map((displayMessageSegment, index) => {
                switch (displayMessageSegment.type) {
                    case "Text":
                    case "SensitiveText":
                        return <Fragment key={index}>{displayMessageSegment.text}</Fragment>;
                    case "Link":
                        return (
                            // TODO(calebmer): We need a generic link component?
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
                                        to={displayMessageSegment.url}
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
                <Box
                    paddingTop="2"
                    color="grey-40"
                    fontSize={{"100": "50" as const, "200": "75" as const}[fontSize]}
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
                    Error code: {error instanceof ErrorBase ? error.code : ErrorCode.Unknown}
                </Box>
            )}
        </Box>
    );
}
