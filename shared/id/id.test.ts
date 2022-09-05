import {generateId, idLength, isId, maxId} from "~/shared/id/id";

test("generates ids that are 26 characters long and less than the maximum id", () => {
    for (let i = 0; i < 10_000; i++) {
        const id = generateId();
        expect(id.length).toEqual(idLength);

        // We want to make sure ids are less than the maximum id to ensure ids only
        // store 128 bits of information. That way we can easily store ids in binary.
        expect(id <= maxId).toEqual(true);

        expect(isId(id)).toEqual(true);
    }
});
