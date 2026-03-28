/**
 * An `ApiContentKey` is used to identify positions in content for our API.
 *
 * An `ApiContentKey` is a URL safe base64 encoded string. The underlying bytes are
 * scrambled using `entityId` as the seed. The unscrambled bytes are:
 *
 * - 1 version bit
 * - 23 bits of the entity hash
 * - version varint
 * - pos varint
 * - node size varint
 */
// NOCOMMIT: I believe we need an "inline" bit on `ApiContentKey`. So we know if
// `type: "Inline"` positions are allowed. `type: "Inline"` positions should not be
// allowed on a `quoteBlock` or `file` node (not that we have `quoteBlock`
// positions right now). When we add the "inline" bit `getApiContentPositionPos()`
// should throw if trying to use an inline position with a non-inline content
// element.
export type ApiContentKey = string & {readonly _ApiContentKey: never};
