import {Link as OriginalLink} from "@remix-run/react";
import classNames from "classnames";
import {MouseEvent, ReactNode} from "react";
import {mergeProps, usePress} from "react-aria";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {linkClassName} from "~/shared/design/core/constant_class_names.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {allSpacingScales} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";

// We want 1px text decoration thickness for font size 75 and 1.5px for font
// size 100. Compute an em value that should give us the right thickness when
// rounded to the nearest 0.5px.
const textDecorationThicknessBySpacingScale = createObjectFromKeys(
    allSpacingScales,
    spacingScale => {
        const em1 = 1 / fontSizesBySpacingScale["75"][spacingScale].fontSize;
        const em2 = 1.5 / fontSizesBySpacingScale["100"][spacingScale].fontSize;
        const finalEm = em1 + (em2 - em1) / 2;
        const roundedEm = Math.round(finalEm * 10000) / 10000;
        return `${roundedEm}em`;
    },
);

export function Link({
    url,
    onClick,
    children,
    newTab = false,
    color,
    colorSchemeOverride,
}: {
    url: string;
    onClick?: (event: MouseEvent) => void;
    children?: ReactNode;
    newTab?: boolean;
    color?: "theme" | "inherit";
    colorSchemeOverride?: "light" | "dark";
}) {
    const spacingScale = useSpacingScale();

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
                        linkClassName,
                        color === "inherit" && contentStyles.linkInheritColorClassName,
                        color === "theme" && colorSchemeOverride === "light"
                            ? contentStyles.linkLightColorSchemeOverrideClassName
                            : undefined,
                        color === "theme" && colorSchemeOverride === "dark"
                            ? contentStyles.linkDarkColorSchemeOverrideClassName
                            : undefined,
                        isPressed ? contentStyles.linkPressedClassName : undefined,
                    )}
                    style={{
                        textDecorationThickness:
                            textDecorationThicknessBySpacingScale[spacingScale],
                    }}
                    // We don't support arbitrary navigation in the native mobile app. Since not all
                    // URLs are openable in the native mobile app.
                    target={newTab || isNativeMobile ? "_blank" : undefined}
                    rel={newTab || isNativeMobile ? "noreferrer" : undefined}
                >
                    {children}
                </a>
            ) : (
                <OriginalLink
                    {...mergeProps(pressProps, {onClick})}
                    to={url}
                    className={classNames(
                        linkClassName,
                        color === "inherit" && contentStyles.linkInheritColorClassName,
                        color === "theme" && colorSchemeOverride === "light"
                            ? contentStyles.linkLightColorSchemeOverrideClassName
                            : undefined,
                        color === "theme" && colorSchemeOverride === "dark"
                            ? contentStyles.linkDarkColorSchemeOverrideClassName
                            : undefined,
                        isPressed ? contentStyles.linkPressedClassName : undefined,
                    )}
                    style={{
                        textDecorationThickness:
                            textDecorationThicknessBySpacingScale[spacingScale],
                    }}
                    // We don't support arbitrary navigation in the native mobile app. Since not all
                    // URLs are openable in the native mobile app.
                    target={newTab || isNativeMobile ? "_blank" : undefined}
                    rel={newTab || isNativeMobile ? "noreferrer" : undefined}
                >
                    {children}
                </OriginalLink>
            )}
        </FocusRing>
    );
}
