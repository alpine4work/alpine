import {ApiMessageContentPayloadParent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

export function fromApiMessageContentPayloadParent(
    parent: ApiMessageContentPayloadParent | undefined,
): MessageContentPayloadParent | null {
    if (!parent) return null;

    switch (parent.type) {
        case "Message": {
            return {type: "Message", index: parent.index};
        }
        case "Post": {
            // TODO(calebmer, #public-api): Implement this but only for post comments.
            throw new UnimplementedError(
                "Creating messages with a post parent isn\u2019t implemented yet",
            );
        }
        default:
            throw exhaustive(parent);
    }
}
