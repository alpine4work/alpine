import {createHash} from "crypto";

/**
 * Create a 128-bit MD5 hash from some binary data.
 */
export function hashMd5(data: ArrayBuffer): ArrayBuffer {
    return createHash("md5").update(new Uint8Array(data)).digest().buffer;
}
