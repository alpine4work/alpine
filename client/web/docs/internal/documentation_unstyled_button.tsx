import {CSSProperties, ReactNode} from "react";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Sprinkles, sprinkles} from "~/client/web/styles/styles.js";

/**
 * A `<button>` that is styled with sprinkles props like a `Box`. Callers are
 * expected to pass their own `border`, `backgroundColor`, and typography props
 * since no user-agent button styling is kept.
 */
export function DocumentationUnstyledButton({
    box,
    style,
    onClick,
    ariaLabel,
    ariaExpanded,
    ariaSelected,
    role,
    className,
    children,
}: {
    box?: Sprinkles;
    style?: CSSProperties;
    onClick?: () => void;
    ariaLabel?: string;
    ariaExpanded?: boolean;
    ariaSelected?: boolean;
    role?: string;
    className?: string;
    children?: ReactNode;
}) {
    const sprinklesClassName = sprinkles(box ?? {});

    return (
        <FocusRing>
            <button
                type="button"
                role={role}
                aria-label={ariaLabel}
                aria-expanded={ariaExpanded}
                aria-selected={ariaSelected}
                onClick={onClick}
                className={className ? `${className} ${sprinklesClassName}` : sprinklesClassName}
                // eslint-disable-next-line cyberworlds/string-quotes -- CSS syntax, not UI copy.
                style={{margin: 0, fontFeatureSettings: '"calt" off', ...style}}
            >
                {children}
            </button>
        </FocusRing>
    );
}
