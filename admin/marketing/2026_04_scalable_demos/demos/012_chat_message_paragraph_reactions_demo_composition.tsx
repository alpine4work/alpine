import {
    chatMessageParagraphReactionsDemoRecording01FirstFrame,
    chatMessageParagraphReactionsDemoRecording01JumpCuts,
    chatMessageParagraphReactionsDemoRecording01LastFrame,
    chatMessageParagraphReactionsDemoRecording01Zoom,
} from "~/admin/marketing/2026_04_scalable_demos/demos/012_chat_message_paragraph_reactions_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {
    scalableDemoDefaultViewportSpacingScale,
    scalableDemoDefaultViewportWidth,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function ChatMessageParagraphReactionsDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_014.jpeg")}
            reaction={{character: {type: "Yeti", variant: "Blue"}, emotion: "Celebrate"}}
            reactionBottom="-6"
            reactionLeft="7"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: scalableDemoDefaultViewportWidth * 2,
                    height: Math.round(scalableDemoDefaultViewportWidth / goldenRatio) * 2,
                }}
            >
                <VideoWithJumpCuts
                    src={remotionFile(
                        "012_chat_message_paragraph_reactions_demo_recording_01.webm",
                    )}
                    volume={0}
                    trimBefore={chatMessageParagraphReactionsDemoRecording01FirstFrame}
                    trimAfter={chatMessageParagraphReactionsDemoRecording01LastFrame}
                    trimSections={chatMessageParagraphReactionsDemoRecording01JumpCuts}
                    style={{
                        position: "absolute",
                        bottom: 40,
                        left:
                            (-1 * scalableDemoDefaultViewportWidth) /
                            (4 / chatMessageParagraphReactionsDemoRecording01Zoom),
                        pointerEvents: "none",
                        zoom: chatMessageParagraphReactionsDemoRecording01Zoom,
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        width: "100%",
                        height: 70,
                        backgroundColor: "white",
                    }}
                ></div>
            </div>
        </ScalableDemoCompositionLayout>
    );
}
