import {generateId, getMaxId, getMinId, isId} from "~/shared/id/id.js";
import {idExclusiveRegExp} from "~/shared/id/id_reg_exp.js";

test("`idExclusiveRegExp` works", () => {
    for (let i = 0; i < 100; i++) {
        expect(idExclusiveRegExp.test(generateId())).toBe(true);
    }

    expect(idExclusiveRegExp.test(getMinId())).toBe(true);
    expect(idExclusiveRegExp.test(getMaxId())).toBe(true);
    expect(idExclusiveRegExp.test("zzzzzzzzzzzzzzzzzzzzzzzzzw")).toBe(true);
    expect(idExclusiveRegExp.test("zzzzzzzzzzzzzzzzzzzzzzzzzx")).toBe(false);
    expect(idExclusiveRegExp.test("zzzzzzzzzzzzzzzzzzzzzzzzzy")).toBe(false);
    expect(idExclusiveRegExp.test("zzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
    expect(idExclusiveRegExp.test("zzzzzzzzzzzzzzzz0zzzzzzzzw")).toBe(true);
    expect(idExclusiveRegExp.test("zzzzzzzzzzzzzzzzozzzzzzzzw")).toBe(false);
    expect(idExclusiveRegExp.test("zzzzzzzzzzzzzzzzzzzzzzzzz0")).toBe(true);
    expect(idExclusiveRegExp.test("zzzzzzzzzzzzzzzzzzzzzzzzzo")).toBe(false);
    expect(isId("zzzzzzzzzzzzzzzzzzzzzzzzzw")).toBe(true);
    expect(isId("zzzzzzzzzzzzzzzzzzzzzzzzzx")).toBe(false);
    expect(isId("zzzzzzzzzzzzzzzzzzzzzzzzzy")).toBe(false);
    expect(isId("zzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
    expect(isId("zzzzzzzzzzzzzzzz0zzzzzzzzw")).toBe(true);
    expect(isId("zzzzzzzzzzzzzzzzozzzzzzzzw")).toBe(false);
    expect(isId("zzzzzzzzzzzzzzzzzzzzzzzzz0")).toBe(true);
    expect(isId("zzzzzzzzzzzzzzzzzzzzzzzzzo")).toBe(false);
});
