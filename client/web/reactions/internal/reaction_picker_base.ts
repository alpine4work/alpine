import {AnimationPlaybackControls} from "motion";
import {ReactionEmotion} from "~/shared/reactions/reaction.js";

export type ReactionPickerRef = {
    animateOut(): AnimationPlaybackControls;
};

export const reactionPickerIconEmotions: ReadonlyArray<ReactionEmotion> = [
    "Laugh",
    "Celebrate",
    "Yes",
    "DeadInside",
    "Shock",
    "Lolsob",
];
