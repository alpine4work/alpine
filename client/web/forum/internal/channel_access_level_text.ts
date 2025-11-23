import {defaultAccessLevelText} from "~/client/web/navigation/access_level_text.js";
import {AccessLevel} from "~/shared/access/access_policy.js";

export const channelAccessLevelText: Record<AccessLevel, string> = {
    Manage: "can post",
    Edit: "can post (can’t share)",
    Comment: defaultAccessLevelText.Comment,
    View: defaultAccessLevelText.View,
};
