import {ComponentType} from "react";
import {Composition as ActualComposition} from "remotion";
import {ShareSwitchDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/001_share_switch_demo_composition.js";
import {shareSwitchDemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/001_share_switch_demo_shared.js";
import {ImageGalleryDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/002_image_gallery_demo_composition.js";
import {
    imageGalleryDemoDurationInFrames,
    imageGalleryDemoRecordingHeight,
    imageGalleryDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/002_image_gallery_demo_shared.js";
import {TaskProgressWheelDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/003_task_progress_wheel_demo_composition.js";
import {
    taskProgressWheelDemoDurationInFrames,
    taskProgressWheelDemoRecordingHeight,
    taskProgressWheelDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/003_task_progress_wheel_demo_shared.js";
import {ReplyToChatMessageRangeDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/004_reply_to_chat_message_range_demo_composition.js";
import {
    replyToChatMessageRangeDemoDurationInFrames,
    replyToChatMessageRangeDemoRecordingHeight,
    replyToChatMessageRangeDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/004_reply_to_chat_message_range_demo_shared.js";
import {ExportTableToMarkdownDemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/005_export_table_to_markdown_demo_composition.js";
import {
    exportTableToMarkdownDemoDurationInFrames,
    exportTableToMarkdownDemoRecordingHeight,
    exportTableToMarkdownDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/005_export_table_to_markdown_demo_shared.js";
import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {scalableDemoNarrowViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

export function ScalableDemosRemotionRoot() {
    return (
        <>
            <Composition
                id="001-share-switch-demo"
                component={ShareSwitchDemoComposition}
                recordingWidth={scalableDemoNarrowViewportWidth}
                durationInFrames={shareSwitchDemoDurationInFrames}
            />
            <Composition
                id="002-image-gallery-demo"
                component={ImageGalleryDemoComposition}
                recordingWidth={imageGalleryDemoRecordingWidth}
                recordingHeight={imageGalleryDemoRecordingHeight}
                durationInFrames={imageGalleryDemoDurationInFrames}
            />
            <Composition
                id="003-task-progress-wheel-demo"
                component={TaskProgressWheelDemoComposition}
                recordingWidth={taskProgressWheelDemoRecordingWidth}
                recordingHeight={taskProgressWheelDemoRecordingHeight}
                durationInFrames={taskProgressWheelDemoDurationInFrames}
            />
            <Composition
                id="004-reply-to-chat-message-range-demo"
                component={ReplyToChatMessageRangeDemoComposition}
                recordingWidth={replyToChatMessageRangeDemoRecordingWidth}
                recordingHeight={replyToChatMessageRangeDemoRecordingHeight}
                durationInFrames={replyToChatMessageRangeDemoDurationInFrames}
            />
            <Composition
                id="005-export-table-to-markdown-demo"
                component={ExportTableToMarkdownDemoComposition}
                recordingWidth={exportTableToMarkdownDemoRecordingWidth}
                recordingHeight={exportTableToMarkdownDemoRecordingHeight}
                durationInFrames={exportTableToMarkdownDemoDurationInFrames}
            />
        </>
    );
}

function Composition({
    id,
    component,
    recordingWidth,
    recordingHeight = recordingWidth / goldenRatio,
    durationInFrames,
}: {
    id: string;
    component: ComponentType<{}>;
    recordingWidth: number;
    recordingHeight?: number;
    durationInFrames: number;
}) {
    const w = recordingWidth;
    const h = recordingHeight;
    const r = goldenRatio;

    // Solution for `m` in:
    //
    // ```
    // w * h * r = (w + m * 2) * (h + m * 2)
    // ```
    //
    // ([WolframAlpha][1])
    //
    // We want the area of the composition to be in the golden ratio with the area of
    // the recording. And we want consistent vertical/horizontal margins.
    //
    // [1]:
    //     https://www.wolframalpha.com/input?i=solve+for+m+in+w+*+h+*+r+%3D+%28w+%2B+m+*+2%29+*+%28h+%2B+m+*+2%29
    const m = (1 / 4) * (Math.sqrt(h ** 2 + 4 * h * r * w - 2 * h * w + w ** 2) - h - w);

    return (
        <ActualComposition
            id={id}
            component={component}
            fps={scalableDemoFps}
            durationInFrames={durationInFrames}
            width={Math.round((w + m * 2) * 2)}
            height={Math.round((h + m * 2) * 2)}
        />
    );
}
