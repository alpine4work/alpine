import {
    getTokenServiceNameByShortName,
    tokenServiceShortNameByName,
} from "~/server/tokens/token_service_name.js";

test("token service short names are unique", () => {
    expect(Object.keys(tokenServiceShortNameByName).length).toEqual(
        getTokenServiceNameByShortName().size,
    );
});

test("token service short names are lower case and three letters", () => {
    for (const shortName of getTokenServiceNameByShortName().keys()) {
        expect(shortName).toMatch(/^[a-z][a-z0-9]{2}$/);
    }
});
