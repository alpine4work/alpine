import {Video} from "@remotion/media";
import {documentCommentHighlightsDemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/021_document_comment_highlights_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {
    scalableDemoDefaultViewportSpacingScale,
    scalableDemoDefaultViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function DocumentCommentHighlightsDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_019.png")}
            reaction={{character: {type: "Yeti", variant: "Blue"}, emotion: "Happy"}}
            reactionBottom="-6"
            reactionLeft="0"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: (scalableDemoDefaultViewportWidth - 85) * 2,
                    height: Math.round(scalableDemoDefaultViewportWidth / goldenRatio) * 2,
                }}
            >
                <Video
                    src={remotionFile("021_document_comment_highlights_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={documentCommentHighlightsDemoRecording01FirstFrame}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarHeight + 10) * 2,
                        left: -150,
                        pointerEvents: "none",
                    }}
                    playbackRate={1.5}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
