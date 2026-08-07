import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {MessageContentPayloadContentUpdate} from "~/shared/messaging/message_schema.js";

export function mapMessagePosFromContentVersion(
    payload: {contentUpdate: MessageContentPayloadContentUpdate | null},
    contentVersion: number,
    pos: number,
    assoc: 1 | -1,
) {
    const currentContentVersion = payload.contentUpdate?.mappings.length ?? 0;

    const mappings =
        currentContentVersion > contentVersion
            ? (payload.contentUpdate?.mappings.slice(-(currentContentVersion - contentVersion)) ??
              emptyArray)
            : emptyArray;

    for (const mapping of mappings) {
        pos = mapping.map(pos, assoc);
    }

    return pos;
}
