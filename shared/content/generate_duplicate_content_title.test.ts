import {generateDuplicateContentTitle} from "~/shared/content/generate_duplicate_content_title.js";

test("adds (copy) suffix", () => {
    expect(generateDuplicateContentTitle("My Document")).toBe("My Document (copy)");
});

test("changes (copy) to (copy 2)", () => {
    expect(generateDuplicateContentTitle("My Document (copy)")).toBe("My Document (copy 2)");
});

test("increments copy number", () => {
    expect(generateDuplicateContentTitle("My Document (copy 2)")).toBe("My Document (copy 3)");
    expect(generateDuplicateContentTitle("My Document (copy 99)")).toBe("My Document (copy 100)");
});
