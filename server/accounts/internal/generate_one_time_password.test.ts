import {generateOneTimePassword} from "~/server/accounts/internal/generate_one_time_password.js";

test("generates one time passwords that are six characters long", () => {
    for (let i = 0; i < 1_000; i++) {
        expect(generateOneTimePassword().length).toEqual(6);
    }
});
