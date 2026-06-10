import {
    imageGalleryDemoRecording01FirstFrame,
    imageGalleryDemoRecording01LastFrame,
    imageGalleryDemoRecordingHeight,
    imageGalleryDemoRecordingJumpCuts,
    imageGalleryDemoRecordingPaddingTop,
    imageGalleryDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/002_image_gallery_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionDeprecatedLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_deprecated_layout.js";
import {scalableDemoNarrowViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export function ImageGalleryDemoComposition() {
    return (
        <ScalableDemoCompositionDeprecatedLayout
            spacingScale={scalableDemoNarrowViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_002.jpeg")}
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
                        trimBefore={imageGalleryDemoRecording01FirstFrame}
                        trimAfter={imageGalleryDemoRecording01LastFrame}
                        trimSections={imageGalleryDemoRecordingJumpCuts}
                        volume={0}
                        style={{
                            position: "absolute",
                            top: -scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight * 2,
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
        </ScalableDemoCompositionDeprecatedLayout>
    );
}
