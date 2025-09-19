import {decodeApiKey, encodeApiKey, generateApiKey, isApiKey} from "~/shared/id/api_key.js";

test("generates correct API keys", () => {
    for (let i = 0; i < 10_000; i++) {
        const id = generateApiKey();

        expect(isApiKey(id)).toEqual(true);

        expect([...decodeApiKey(encodeApiKey(decodeApiKey(id)))]).toEqual([...decodeApiKey(id)]);
    }
});
