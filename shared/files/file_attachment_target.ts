import {ChannelId, ChatId, DocumentId, PostId, TaskId} from "~/shared/id/types/id_types.js";

/**
 * Files may be attached to various entities in our system. A file may be
 * attached to zero, one, or many entities. You can attach one file to multiple
 * entities by copy/pasting it.
 *
 * This type represents the target of an attachment. You can think of a file
 * attachment as a link of `source -> target` where "source" is the file and
 * "target" is the entity the file is attached to.
 *
 * The attachment target is in this tuple format which makes it a little easier
 * to decompose for our `FileAuthorizer` helper.
 *
 * Some notes:
 *
 * - Files attached to posts use the `Post` attachment target not the `Channel`
 *   attachment target. This way posts can move between channels.
 *
 * - Files attached to messages are considered attached to their parent. For
 *   example chat messages are attached to the `Chat` target, document comments
 *   are attached to the `Document` target, post comments are attached to the
 *   `Post` target, and so on. This simplifies authorization.
 */
export type FileAttachmentTarget =
    | readonly ["Chat", ChatId]
    | readonly ["Channel", ChannelId]
    | readonly ["Document", DocumentId]
    | readonly ["Post", PostId]
    | readonly ["Task", TaskId];
