import {unknownFileId} from "~/shared/api/content/unknown_file_id.js";
import {getChronologicalIdTime} from "~/shared/id/chronological_id.js";

test("unknownFileId has a chronological time of 0", () => {
    expect(getChronologicalIdTime(unknownFileId)).toBe(0);
});
