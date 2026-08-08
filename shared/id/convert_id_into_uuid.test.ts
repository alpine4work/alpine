import {convertIdIntoUuid, convertUuidIntoId} from "~/shared/id/convert_id_into_uuid.js";
import {generateId} from "~/shared/id/id.open_source.js";

test("converts UUIDs correctly", () => {
    for (let i = 0; i < 10_000; i++) {
        const id = generateId();
        const uuid = convertIdIntoUuid(id);

        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

        expect(convertUuidIntoId(uuid)).toEqual(id);
    }
});
