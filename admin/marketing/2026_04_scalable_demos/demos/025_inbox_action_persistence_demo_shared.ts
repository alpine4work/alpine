import {scalableDemoFps} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_fps.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.open_source.js";
import {goldenRatio} from "~/shared/helpers/number/golden_ratio.js";

const inboxActionPersistenceDemoInboxSideBarWidthRem = parseRemLength("96");
const inboxActionPersistenceDemoPeekWidthRem = parseRemLength("128");

export const inboxActionPersistenceDemoRecordingWidth = Math.round(
    (inboxActionPersistenceDemoInboxSideBarWidthRem + inboxActionPersistenceDemoPeekWidthRem) *
        remPxBySpacingScale.small,
);
export const inboxActionPersistenceDemoRecordingHeight = Math.round(
    inboxActionPersistenceDemoRecordingWidth / goldenRatio,
);

const inboxActionPersistenceDemoRecording01FirstFrameWithoutPadding = 281;
const inboxActionPersistenceDemoRecording01LastFrameWithoutPadding = 1043;

export const inboxActionPersistenceDemoRecording01FirstFrame =
    inboxActionPersistenceDemoRecording01FirstFrameWithoutPadding - scalableDemoFps / 4;
export const inboxActionPersistenceDemoRecording01LastFrame =
    inboxActionPersistenceDemoRecording01LastFrameWithoutPadding + scalableDemoFps * 1.5;

export const inboxActionPersistenceDemoDurationInFrames =
    inboxActionPersistenceDemoRecording01LastFrame -
    inboxActionPersistenceDemoRecording01FirstFrame;
