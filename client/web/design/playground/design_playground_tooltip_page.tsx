import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {OverlayPlacement} from "~/client/web/design/overlay.js";
import {DesignPlaygroundScrollPreview} from "~/client/web/design/playground/helpers/design_playground_scroll_preview.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useUrlSearchParamBooleanState} from "~/client/web/remix/use_url_search_param_boolean_state.js";
import {useUrlSearchParamState} from "~/client/web/remix/use_url_search_param_state.js";

// TODO(calebmer): Use actual design system select element

// TODO(calebmer): Use actual design system checkbox element

const defaultOverlayPlacement: OverlayPlacement = "bottom-start";

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
            <DesignPlaygroundScrollPreview
                // Recenter the content if we're switching between vertical and
                // horizontal placements.
                key={String(overlayPlacementVertical)}
                shouldRenderOverlaysInDocumentBody={shouldRenderOverlaysInDocumentBody}
            >
                <Box
                    display="flex"
                    flexDirection={overlayPlacementVertical ? "row" : "column"}
                    gap="4"
                >
                    <Box>
                        <Tooltip placement={overlayPlacement} content="Tooltip content 1">
                            <Button variant="quiet">Button 1</Button>
                        </Tooltip>
                    </Box>
                    <Box>
                        <Tooltip placement={overlayPlacement} content="Tooltip content 2">
                            <Button variant="quiet">Button 2</Button>
                        </Tooltip>
                    </Box>
                    <Box>
                        <Tooltip placement={overlayPlacement} content="Tooltip content 3">
                            <Button variant="quiet">Button 3</Button>
                        </Tooltip>
                    </Box>
                </Box>
            </DesignPlaygroundScrollPreview>
        </>
    );
}
