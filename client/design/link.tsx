// eslint-disable-next-line no-restricted-imports
import {Link as OriginalLink} from "@remix-run/react";
import classNames from "classnames";
import {MouseEvent, ReactNode} from "react";
import {mergeProps, usePress} from "react-aria";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

export function Link({
    url,
    onClick,
    children,
}: {
    url: string;
    onClick?: (event: MouseEvent) => void;
    children?: ReactNode;
}) {
    // Make sure link is well-formed.
    assert(
        url.startsWith("/") || startsWithSafeUrlProtocol(url),
        "Invalid URL for `<Link>` component",
    );

    const {isNativeMobile} = useClientInfo();

    const {pressProps, isPressed} = usePress({});

    return (
        <FocusRing>
            {startsWithSafeUrlProtocol(url) ? (
                <a
                    {...mergeProps(pressProps, {onClick})}
                    href={url}
                    className={classNames(
                        contentSchemaStyles.linkClassName,
                        isPressed ? contentSchemaStyles.linkPressedClassName : undefined,
                    )}
                    // We don't support arbitrary navigation in the native mobile app. Since not
                    // all URLs are openable in the native mobile app.
                    target={isNativeMobile ? "_blank" : undefined}
                    rel={isNativeMobile ? "noreferrer" : undefined}
                >
                    {children}
                </a>
            ) : (
                <OriginalLink
                    {...mergeProps(pressProps, {onClick})}
                    to={url}
                    className={classNames(
                        contentSchemaStyles.linkClassName,
                        isPressed ? contentSchemaStyles.linkPressedClassName : undefined,
                    )}
                    // We don't support arbitrary navigation in the native mobile app. Since not
                    // all URLs are openable in the native mobile app.
                    target={isNativeMobile ? "_blank" : undefined}
                    rel={isNativeMobile ? "noreferrer" : undefined}
                >
                    {children}
                </OriginalLink>
            )}
        </FocusRing>
    );
}
