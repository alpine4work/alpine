/**
 * An `ApiContentKey` is used to identify positions in content for our API.
 *
 * An `ApiContentKey` is a URL safe base64 encoded string. The underlying bytes are
 * scrambled using `entityId` as the seed. The unscrambled bytes are:
 *
 * - 1 version bit
 * - 1 inline bit (whether the keyed element has inline content and so allows
 *   `type: "Inline"` positions)
 * - 22 bits of the entity hash
 * - version varint
 * - pos varint
 * - node size varint
 */
export type ApiContentKey = string & {readonly _ApiContentKey: never};
