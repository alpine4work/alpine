import {Link} from "@remix-run/react";
import {CSSProperties, ReactNode} from "react";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Sprinkles, sprinkles} from "~/client/web/styles/styles.js";

/**
 * An internal docs link that navigates client-side without the default link
 * styling. Accepts sprinkles props (via `box`) so link containers can be styled
 * like a `Box`.
 */
export function DocumentationLink({
    url,
    box,
    style,
    ariaLabel,
    ariaCurrent,
    className,
    children,
}: {
    url: string;
    box?: Sprinkles;
    style?: CSSProperties;
    ariaLabel?: string;
    ariaCurrent?: "page";
    className?: string;
    children: ReactNode;
}) {
    const sprinklesClassName = sprinkles(box ?? {});

    return (
        <FocusRing>
            <Link
                to={url}
                prefetch="intent"
                aria-label={ariaLabel}
                aria-current={ariaCurrent}
                className={className ? `${className} ${sprinklesClassName}` : sprinklesClassName}
                style={{textDecoration: "none", color: "inherit", ...style}}
            >
                {children}
            </Link>
        </FocusRing>
    );
}
