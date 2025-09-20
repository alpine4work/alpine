import {createHash} from "crypto";

/**
 * Create a 128-bit MD5 hash from some binary data.
 */
export function hashMd5(data: ArrayBuffer): ArrayBuffer {
    const {buffer} = createHash("md5").update(new Uint8Array(data)).digest();

    // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
    // fixing for now.
    // @ts-expect-error
    return buffer;
}
