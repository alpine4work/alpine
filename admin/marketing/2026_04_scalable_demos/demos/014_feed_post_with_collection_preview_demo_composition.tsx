import {Video} from "@remotion/media";
import {feedPostWithCollectionPreviewDemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/014_feed_post_with_collection_preview_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {
    scalableDemoDefaultViewportSpacingScale,
    scalableDemoDefaultViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function FeedPostWithCollectionPreviewDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_018.jpeg")}
            reaction={{character: {type: "Pigeon", variant: "Plain"}, emotion: "Celebrate"}}
            reactionBottom="-6"
            reactionLeft={350}
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: scalableDemoDefaultViewportWidth * 2,
                    height: Math.round(scalableDemoDefaultViewportWidth / goldenRatio) * 2 - 18,
                }}
            >
                <Video
                    src={remotionFile(
                        "014_feed_post_with_collection_preview_demo_recording_01.webm",
                    )}
                    volume={0}
                    trimBefore={feedPostWithCollectionPreviewDemoRecording01FirstFrame}
                    style={{
                        position: "absolute",
                        bottom: -14,
                        left: 0,
                        pointerEvents: "none",
                        scale: 0.98,
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "40px",
                        backgroundColor: "white",
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        width: "30px",
                        height: "100%",
                        backgroundColor: "white",
                    }}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
