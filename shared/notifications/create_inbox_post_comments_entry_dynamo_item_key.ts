import {DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {decodeIdInto} from "~/shared/id/id.js";
import {AccountId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Manually build a `DynamoItemKey` for an `InboxPostCommentsEntryModel` using the
 * same process the server uses. The data within `DynamoItemKey`s is not secure by
 * design, they're trivial to reverse engineer by clients. Like we do here.
 */
export function createInboxPostCommentsEntryDynamoItemKey(
    spaceId: SpaceId,
    accountId: AccountId,
    postId: PostId,
): DynamoItemKey {
    const totalByteCount =
        1 + // Partition `id`
        16 + // `SpaceId` byte length
        16 + // `AccountId` byte length
        3 + // Sort range `OrderKey`
        1 + // Sort range `id`
        16; // `PostId` byte length

    const bytes = new Uint8Array(totalByteCount);
    let byteIndex = 0;

    bytes[byteIndex++] = 0;
    decodeIdInto(spaceId, bytes, byteIndex);
    byteIndex += 16;
    decodeIdInto(accountId, bytes, byteIndex);
    byteIndex += 16;
    bytes[byteIndex++] = 37;
    bytes[byteIndex++] = 3;
    bytes[byteIndex++] = 0;
    bytes[byteIndex++] = 2;
    decodeIdInto(postId, bytes, byteIndex);
    byteIndex += 16;

    return encodeBase64(bytes, "Rfc4648UrlWithOrderPreservation") as DynamoItemKey;
}
