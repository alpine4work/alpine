import type {Node} from "prosemirror-model";
import {ApiContentKeyDecoder} from "~/shared/api/content/api_content_key.js";
import {getApiContentPositionPos} from "~/shared/api/content/get_api_content_position_pos.js";
import {ApiContentPosition} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

/**
 * Decodes and validates an API content range against its referenced content
 * version.
 */
export async function getApiContentRange<Content extends Node>({
    entityId,
    latestVersion,
    range,
    getContentAtVersion,
}: {
    entityId: string;
    latestVersion: number;
    range: {
        start: ApiContentPosition;
        end: ApiContentPosition;
    };
    getContentAtVersion: (version: number) => Promise<Content>;
}) {
    const decoder = new ApiContentKeyDecoder(entityId);
    const startKeyData = decoder.decode(range.start.key);
    const endKeyData = decoder.decode(range.end.key);

    if (startKeyData.version !== endKeyData.version) {
        throw new InvalidArgumentError(
            "Item target range start and end must be for the same item version",
            {
                displayMessage: errorDisplayMessage`Item target range start and end must be for the same item version.`,
            },
        );
    }

    if (startKeyData.version > latestVersion) {
        throw new InvalidArgumentError("Item target range version is newer than the content", {
            displayMessage: errorDisplayMessage`Item target range version is newer than the content.`,
        });
    }

    const contentAtVersion = await getContentAtVersion(startKeyData.version);
    const startNode = contentAtVersion.nodeAt(startKeyData.pos);
    const endNode = contentAtVersion.nodeAt(endKeyData.pos);
    const from = getApiContentPositionPos(startKeyData, range.start, startNode, "Start");
    const to = getApiContentPositionPos(endKeyData, range.end, endNode, "End");
    const isTargetingWholeLeafNode =
        range.start.type === "Before" &&
        range.end.type === "After" &&
        startKeyData.pos === endKeyData.pos &&
        startNode?.isLeaf === true;

    if (from > to || (!isTargetingWholeLeafNode && from === to)) {
        throw new InvalidArgumentError("Item target range start must be before the end", {
            displayMessage: errorDisplayMessage`Item target range start must be before the end.`,
        });
    }

    return {
        version: startKeyData.version,
        contentAtVersion,
        from,
        to,
        startNodePos: startKeyData.pos,
        isTargetingWholeLeafNode,
    };
}
