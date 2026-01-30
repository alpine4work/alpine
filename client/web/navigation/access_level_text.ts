import {AccessLevel} from "~/shared/access/access_policy.js";

export const defaultAccessLevelText: Record<AccessLevel, string> = {
    Manage: "can edit",
    Edit: "can edit (can\u2019t share)",
    Comment: "can comment",
    View: "can view",
};

export const noAccessLevelText = "can\u2019t access";

export const removeAccessLevelText = "remove access";
