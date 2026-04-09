import {Video} from "@remotion/media";
import {ComponentProps} from "react";
import {Series} from "remotion";
import {
    imageGalleryDemoRecording01FirstFrame,
    imageGalleryDemoRecording01LastFrame,
    imageGalleryDemoRecordingHeight,
    imageGalleryDemoRecordingJumpCuts,
    imageGalleryDemoRecordingPaddingTop,
    imageGalleryDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/002_image_gallery_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoNarrowViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export function ImageGalleryDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoNarrowViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_02.jpeg")}
            reactionBottom="-10"
            reactionLeft="4"
            reaction={{character: {type: "Yeti", variant: "Brown"}, emotion: "Happy"}}
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: imageGalleryDemoRecordingWidth * 2,
                    height: imageGalleryDemoRecordingHeight * 2,
                    paddingTop: imageGalleryDemoRecordingPaddingTop * 2,
                }}
            >
                <div
                    style={{
                        position: "relative",
                        overflow: "hidden",
                        width: "100%",
                        height: "100%",
                    }}
                >
                    <VideoWithJumpCuts
                        src={remotionFile("002_image_gallery_demo_recording_01.webm")}
                        volume={0}
                        style={{
                            position: "absolute",
                            top: -scalableDemoMacOsTopBarAndChromeTopBarHeight * 2,
                            left:
                                -convertRemLengthToPx(
                                    scalableDemoSpaceSideBarWidth,
                                    scalableDemoNarrowViewportSpacingScale,
                                ) * 2,
                            pointerEvents: "none",
                        }}
                    />
                </div>
            </div>
        </ScalableDemoCompositionLayout>
    );
}

function VideoWithJumpCuts(props: ComponentProps<typeof Video>) {
    const sections: Array<{trimBefore: number; trimAfter: number}> = [];

    let nextTrimBefore = imageGalleryDemoRecording01FirstFrame;

    for (const {startFrame, endFrame} of imageGalleryDemoRecordingJumpCuts) {
        sections.push({trimBefore: nextTrimBefore, trimAfter: startFrame});
        nextTrimBefore = endFrame + 1;
    }

    sections.push({
        trimBefore: nextTrimBefore,
        trimAfter: imageGalleryDemoRecording01LastFrame,
    });

    return (
        <Series>
            {sections.map(({trimBefore, trimAfter}, index) => (
                <Series.Sequence
                    key={index}
                    durationInFrames={trimAfter - trimBefore}
                    premountFor={scalableDemoFps}
                >
                    <Video {...props} trimBefore={trimBefore} trimAfter={trimAfter} />
                </Series.Sequence>
            ))}
        </Series>
    );
}
