import {Video} from "@remotion/media";
import {inboxTriageDemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/013_inbox_triage_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {
    scalableDemoDefaultViewportSpacingScale,
    scalableDemoDefaultViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function InboxTriageDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_016.jpeg")}
            reaction={{character: {type: "Tree", variant: "Green"}, emotion: "Heart"}}
            reactionBottom="-6"
            reactionLeft="7"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: scalableDemoDefaultViewportWidth * 2,
                    height: Math.round(scalableDemoDefaultViewportWidth / goldenRatio) * 2 - 20,
                }}
            >
                <Video
                    src={remotionFile("013_inbox_triage_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={inboxTriageDemoRecording01FirstFrame}
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
