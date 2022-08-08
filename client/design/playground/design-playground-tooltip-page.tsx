import {Box} from "~/client/design/box";
import {OverlayPlacement} from "~/client/design/overlay";
import {DesignPlaygroundScrollPreview} from "~/client/design/playground/helpers/design-playground-scroll-preview";
import {Tooltip} from "~/client/design/tooltip";
import {useUrlSearchParamBooleanState} from "~/client/helpers/url/use-url-search-param-boolean-state";
import {useUrlSearchParamState} from "~/client/helpers/url/use-url-search-param-state";

// TODO(calebmer): Use actual design system select element

// TODO(calebmer): Use actual design system checkbox element

// TODO(calebmer): Use actual design system button element

const defaultOverlayPlacement: OverlayPlacement = "top";

const allOverlayPlacements: ReadonlySet<OverlayPlacement> = new Set([
    "top",
    "top-start",
    "top-end",
    "bottom",
    "bottom-start",
    "bottom-end",
    "right",
    "right-start",
    "right-end",
    "left",
    "left-start",
    "left-end",
]);

function isOverlayPlacement(placement: string): placement is OverlayPlacement {
    return allOverlayPlacements.has(placement as any);
}

export function DesignPlaygroundTooltipPage() {
    const [actualOverlayPlacement, setOverlayPlacement] = useUrlSearchParamState("placement");
    const [shouldRenderOverlaysInDocumentBody, setShouldRenderOverlaysInDocumentBody] =
        useUrlSearchParamBooleanState("overlays", {trueString: "body"});

    const overlayPlacement: OverlayPlacement =
        actualOverlayPlacement === null
            ? defaultOverlayPlacement
            : isOverlayPlacement(actualOverlayPlacement)
            ? actualOverlayPlacement
            : defaultOverlayPlacement;

    const overlayPlacementVertical =
        overlayPlacement.includes("top") || overlayPlacement.includes("bottom");

    return (
        <>
            <div>
                <label>
                    Overlay placement{" "}
                    <select
                        value={overlayPlacement}
                        onChange={event => setOverlayPlacement(event.currentTarget.value)}
                    >
                        {[...allOverlayPlacements].map(placement => (
                            <option key={placement}>{placement}</option>
                        ))}
                    </select>
                </label>
            </div>
            <div>
                <label>
                    <input
                        type="checkbox"
                        checked={shouldRenderOverlaysInDocumentBody}
                        onChange={() =>
                            setShouldRenderOverlaysInDocumentBody(
                                !shouldRenderOverlaysInDocumentBody,
                            )
                        }
                    />{" "}
                    Should render overlays in document body
                </label>
            </div>
            <hr />
            <DesignPlaygroundScrollPreview
                // Recenter the content if we’re switching between vertical and
                // horizontal placements.
                key={`${overlayPlacementVertical}`}
                shouldRenderOverlaysInDocumentBody={shouldRenderOverlaysInDocumentBody}
            >
                <Box display="flex" flexDirection={overlayPlacementVertical ? "row" : "column"}>
                    <Box
                        marginRight={overlayPlacementVertical ? "4" : undefined}
                        marginBottom={overlayPlacementVertical ? undefined : "4"}
                    >
                        <Tooltip placement={overlayPlacement} content="Tooltip content 1">
                            <button>Button 1</button>
                        </Tooltip>
                    </Box>
                    <Box
                        marginRight={overlayPlacementVertical ? "4" : undefined}
                        marginBottom={overlayPlacementVertical ? undefined : "4"}
                    >
                        <Tooltip placement={overlayPlacement} content="Tooltip content 2">
                            <button>Button 2</button>
                        </Tooltip>
                    </Box>
                    <Box>
                        <Tooltip placement={overlayPlacement} content="Tooltip content 3">
                            <button>Button 3</button>
                        </Tooltip>
                    </Box>
                </Box>
            </DesignPlaygroundScrollPreview>
        </>
    );
}
