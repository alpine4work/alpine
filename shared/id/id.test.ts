import {generateId} from "~/shared/id/id";

test("generates ids that are 26 characters long", () => {
    for (let index = 0; index < 10_000; index++) {
        expect(generateId().length).toEqual(26);
    }
});
