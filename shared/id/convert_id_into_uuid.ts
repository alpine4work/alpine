import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {Id, decodeId, encodeId} from "~/shared/id/id.open_source.js";

/**
 * Convert an `Id` into [UUID][1] format. Both formats are backed by 128 bits so
 * they are interchangeable. For example, `xpt7j5z5v20nm7ejpxpcvx8w84` is converted
 * into `edb47917-e5d8-815a-1dd2-b76ccdf51c41`.
 *
 * [1]: https://en.wikipedia.org/wiki/Universally_unique_identifier
 */
export function convertIdIntoUuid(id: Id): string {
    const bytes = decodeId(id);

    const byteStrings = Array.from(bytes, byte => byte.toString(16).padStart(2, "0"));
    assert(byteStrings.length === 16);

    return (
        byteStrings[0]! +
        byteStrings[1]! +
        byteStrings[2]! +
        byteStrings[3]! +
        "-" +
        byteStrings[4]! +
        byteStrings[5]! +
        "-" +
        byteStrings[6]! +
        byteStrings[7]! +
        "-" +
        byteStrings[8]! +
        byteStrings[9]! +
        "-" +
        byteStrings[10]! +
        byteStrings[11]! +
        byteStrings[12]! +
        byteStrings[13]! +
        byteStrings[14]! +
        byteStrings[15]!
    );
}

/**
 * Convert a [UUID][1] to our `Id` format. Both formats are backed by 128 bits so
 * they are interchangeable. For example, `edb47917-e5d8-815a-1dd2-b76ccdf51c41` is
 * converted into `xpt7j5z5v20nm7ejpxpcvx8w84`.
 *
 * [1]: https://en.wikipedia.org/wiki/Universally_unique_identifier
 */
export function convertUuidIntoId(uuid: string): Id {
    assert(uuid.length === 36);

    const uuidParts = uuid.split("-");
    assert(uuidParts.length === 5);

    const uuidPart1 = uuidParts[0]!;
    const uuidPart2 = uuidParts[1]!;
    const uuidPart3 = uuidParts[2]!;
    const uuidPart4 = uuidParts[3]!;
    const uuidPart5 = uuidParts[4]!;

    assert(uuidPart1.length === 8);
    assert(uuidPart2.length === 4);
    assert(uuidPart3.length === 4);
    assert(uuidPart4.length === 4);
    assert(uuidPart5.length === 12);

    const string = uuidPart1 + uuidPart2 + uuidPart3 + uuidPart4 + uuidPart5;
    const bytes = new Uint8Array(16);

    for (let i = 0; i < string.length; i += 2) {
        const char1 = string[i]!;
        const char2 = string[i + 1]!;

        bytes[i / 2] = parseInt(char1 + char2, 16);
    }

    return encodeId(bytes);
}
