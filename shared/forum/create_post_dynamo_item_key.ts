import {DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {decodeIdInto} from "~/shared/id/id.js";
import {PostId} from "~/shared/id/types/id_types.js";

/**
 * Manually build a `DynamoItemKey` from a `PostId` using the same process the
 * server uses. The data within `DynamoItemKey`s is not secure by design, they're
 * trivial to reverse engineer by clients. Like we do here.
 */
export function createPostDynamoItemKey(postId: PostId): DynamoItemKey {
    const totalByteCount =
        1 + // Partition `id`
        16 + // `PostId` byte length
        3 + // Sort range `OrderKey`
        1; // Sort range `id`

    const bytes = new Uint8Array(totalByteCount);
    let byteIndex = 0;

    bytes[byteIndex++] = 1;
    decodeIdInto(postId, bytes, byteIndex);
    byteIndex += 16;
    bytes[byteIndex++] = 37;
    bytes[byteIndex++] = 1;
    bytes[byteIndex++] = 0;
    bytes[byteIndex++] = 0;

    return encodeBase64(bytes, "Rfc4648UrlWithOrderPreservation") as DynamoItemKey;
}
