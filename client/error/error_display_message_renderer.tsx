import {Link} from "@remix-run/react";
import {Fragment, useEffect} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {ErrorBase} from "~/shared/error/error";
import {ErrorCode} from "~/shared/error/error_code";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol";
import {contentSchemaStyles} from "~/shared/styles/styles";

const defaultErrorDisplayMessage = errorDisplayMessage`An unexpected error occurred. Please try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;

export function ErrorDisplayMessageRenderer({
    error,
    size = "small",
}: {
    error: unknown;
    size?: "small" | "body";
}) {
    const displayMessage = error instanceof ErrorBase ? error.displayMessage : null;

    // Log errors to the console as well after we render them to help the
    // developer debug.
    useEffect(() => {
        // Log after a microtask so we don't get the React component trace in the error
        // log. The trace will always point to our error message renderer which
        // isn't useful.
        scheduleMicrotask(() => {
            // eslint-disable-next-line no-console
            console.error(error);
        });
    }, [error]);

    return (
        <Box color="grey-80" fontStyle="primary" fontSize={size}>
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
                    fontSize={{small: "tiny" as const, body: "small" as const}[size]}
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
