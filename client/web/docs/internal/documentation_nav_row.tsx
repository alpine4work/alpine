import {ReactNode} from "react";
import {useHover} from "react-aria";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {DocumentationLink} from "~/client/web/docs/internal/documentation_link.js";

/**
 * A rounded sidebar navigation row. The active row gets a `grey-5` fill and
 * heavier weight; hovering fills with `grey-1`.
 */
export function DocumentationNavRow({
    url,
    active,
    badge,
    tooltip,
    children,
}: {
    url: string;
    active: boolean;
    badge?: ReactNode;
    tooltip?: ReactNode;
    children: ReactNode;
}) {
    const {hoverProps, isHovered} = useHover({});

    const row = (
        <div {...hoverProps}>
            <DocumentationLink
                url={url}
                ariaCurrent={active ? "page" : undefined}
                box={{
                    display: "flex",
                    alignItems: "center",
                    gap: "2",
                    paddingX: "2.5",
                    paddingY: "1.5",
                    borderRadius: "2",
                    fontSize: "75",
                    fontStyle: active ? "semi-bold" : "normal",
                    color: active ? "grey-90" : "grey-50",
                    backgroundColor: active ? "grey-5" : isHovered ? "grey-1" : "transparent",
                }}
                style={{transition: "background-color 0.12s ease"}}
            >
                {badge}
                <span
                    style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                    }}
                >
                    {children}
                </span>
            </DocumentationLink>
        </div>
    );

    return tooltip == null ? (
        row
    ) : (
        <Tooltip
            content={tooltip}
            placement="right"
            offset="2"
            isVisibleWhenFocusWithin={true}
            isVisibleAfterPress={true}
        >
            {row}
        </Tooltip>
    );
}
