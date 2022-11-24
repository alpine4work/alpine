import {Link} from "@remix-run/react";
import {Fragment} from "react";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {ErrorBase} from "~/shared/error/error";
import {ErrorCode} from "~/shared/error/error_code";
import {ErrorDisplayMessage, errorDisplayMessage} from "~/shared/error/error_display_message";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol";
import {contentSchemaStyles} from "~/shared/styles/styles";

export function ErrorDisplayMessageRenderer({error}: {error: unknown}) {
    const displayMessage =
        (error instanceof ErrorBase ? error.displayMessage : null) ??
        getDefaultErrorDisplayMessageByCode(
            error instanceof ErrorBase ? error.code : ErrorCode.Unknown,
        );

    return (
        <Box color="grey-80" typographySize="small">
            {displayMessage.map((displayMessageSegment, index) => {
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
        </Box>
    );
}

/**
 * Get a default error message to display to the user for a given error code.
 * These error messages have no context around what the user was doing so need
 * to be very generic. This leads to unhelpful error messages.
 *
 * We should aim to never show a default error message to users. They exist as
 * a fallback when all else fails.
 */
// TODO(calebmer): These error messages are so unspecific. Add instrumentation
// for when we show a default error message to users and aim to clean them.
function getDefaultErrorDisplayMessageByCode(code: ErrorCode): ErrorDisplayMessage {
    switch (code) {
        case ErrorCode.Cancelled:
        case ErrorCode.Aborted:
            return errorDisplayMessage`Some process was stopped before it could complete. Please try again.`;
        case ErrorCode.Unknown:
        case ErrorCode.Internal:
        case ErrorCode.DataLoss:
            return errorDisplayMessage`An unexpected error occurred. Please try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;
        case ErrorCode.InvalidArgument:
            return errorDisplayMessage`Some data is incorrectly formatted. Please review any information you\u2019ve entered and try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;
        case ErrorCode.DeadlineExceeded:
            return errorDisplayMessage`Some process was taking to long to complete so we stopped it. Please try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;
        case ErrorCode.NotFound:
            return errorDisplayMessage`Some data was not found. Please try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;
        case ErrorCode.AlreadyExists:
            return errorDisplayMessage`Some data already exists and can not be recreated. Please try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;
        case ErrorCode.PermissionDenied:
            return errorDisplayMessage`You are not allowed to. Ask the owner of this data for access.`;
        case ErrorCode.ResourceExhausted:
            return errorDisplayMessage`All of some resource has been used up. Please wait a few seconds and try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;
        case ErrorCode.FailedPrecondition:
        case ErrorCode.OutOfRange:
            return errorDisplayMessage`Some data was different than what was expected. Please wait a few seconds and try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;
        case ErrorCode.Unimplemented:
            return errorDisplayMessage`You are trying to do something that isn\u2019t supported. Please let us know at ${errorDisplayMessage.supportLink}.`;
        case ErrorCode.Unavailable:
            return errorDisplayMessage`Some system is currently unavailable. Please wait a few minutes and try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}.`;
        case ErrorCode.Unauthenticated:
            return errorDisplayMessage`You are not signed in. Please ${errorDisplayMessage.link(
                "sign in",
                "/sign-in",
            )} and try again.`;
        default:
            throw exhaustive(code);
    }
}
