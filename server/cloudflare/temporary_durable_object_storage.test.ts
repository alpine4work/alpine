import {TemporaryDurableObjectStorage} from "~/server/cloudflare/temporary_durable_object_storage.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";

async function seedStorage(storage: TemporaryDurableObjectStorage) {
    const entries: Array<[string, number]> = [
        ["a", 1],
        ["aa", 2],
        ["ab", 3],
        ["b", 4],
        ["ba", 5],
        ["c", 6],
    ];

    for (const [key, value] of entries) {
        await storage.put(key, value);
    }
}

function keysFromMap(map: Map<string, unknown>) {
    return Array.from(map.keys());
}

test("get returns undefined for missing keys and put stores values", async () => {
    const storage = new TemporaryDurableObjectStorage();

    expect(await storage.get("missing")).toBeUndefined();

    await storage.put("alpha", {count: 1});
    expect(await storage.get<{count: number}>("alpha")).toEqual({count: 1});
});

test("put overwrites existing values", async () => {
    const storage = new TemporaryDurableObjectStorage();

    await storage.put("alpha", 1);
    await storage.put("alpha", 2);

    expect(await storage.get<number>("alpha")).toBe(2);
});

test("delete returns whether the key existed", async () => {
    const storage = new TemporaryDurableObjectStorage();

    expect(await storage.delete("missing")).toBe(false);

    await storage.put("alpha", 1);
    expect(await storage.delete("alpha")).toBe(true);
    expect(await storage.get("alpha")).toBeUndefined();
});

test("list returns keys in ascending order by default", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>();
    expect(keysFromMap(result)).toEqual(["a", "aa", "ab", "b", "ba", "c"]);
});

test("list respects start and end boundaries", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({start: "ab", end: "c"});
    expect(keysFromMap(result)).toEqual(["ab", "b", "ba"]);
});

test("list returns empty when start is after all values", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({start: "d"});
    expect(keysFromMap(result)).toEqual([]);
});

test("list respects start before any values", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({start: "0"});
    expect(keysFromMap(result)).toEqual(["a", "aa", "ab", "b", "ba", "c"]);
});

test("list respects startAfter even when the key is missing", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({startAfter: "aa0"});
    expect(keysFromMap(result)).toEqual(["ab", "b", "ba", "c"]);
});

test("list supports prefix filtering in ascending order", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({prefix: "a"});
    expect(keysFromMap(result)).toEqual(["a", "aa", "ab"]);
});

test("list supports multi-character prefix filtering", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({prefix: "ab"});
    expect(keysFromMap(result)).toEqual(["ab"]);
});

test("list supports prefix filtering when the prefix key is missing", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    await storage.put("ax1", 7);
    await storage.put("ax2", 8);

    const result = await storage.list<number>({prefix: "ax"});
    expect(keysFromMap(result)).toEqual(["ax1", "ax2"]);
});

test("list supports prefix with start boundary", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({prefix: "a", start: "aa"});
    expect(keysFromMap(result)).toEqual(["aa", "ab"]);
});

test("list supports prefix with end boundary", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({prefix: "a", end: "ab"});
    expect(keysFromMap(result)).toEqual(["a", "aa"]);
});

test("list supports reverse order and end above max", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({reverse: true, end: "z"});
    expect(keysFromMap(result)).toEqual(["c", "ba", "b", "ab", "aa", "a"]);
});

test("list supports reverse order with end boundary", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({reverse: true, end: "c"});
    expect(keysFromMap(result)).toEqual(["ba", "b", "ab", "aa", "a"]);
});

test("list supports reverse order with start boundary", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({reverse: true, start: "ab"});
    expect(keysFromMap(result)).toEqual(["c", "ba", "b", "ab"]);
});

test("list supports reverse order with start and end", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({reverse: true, start: "ab", end: "c"});
    expect(keysFromMap(result)).toEqual(["ba", "b", "ab"]);
});

test("list supports reverse order with startAfter", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({reverse: true, startAfter: "ab"});
    expect(keysFromMap(result)).toEqual(["c", "ba", "b"]);
});

test("list supports prefix filtering in reverse order", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({prefix: "a", reverse: true});
    expect(keysFromMap(result)).toEqual(["ab", "aa", "a"]);
});

test("list supports multi-character prefix filtering in reverse order", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    await storage.put("aba", 7);
    await storage.put("abb", 8);
    await storage.put("abz", 9);

    const result = await storage.list<number>({prefix: "ab", reverse: true});
    expect(keysFromMap(result)).toEqual(["abz", "abb", "aba", "ab"]);
});

test("list supports reverse prefix filtering when the prefix key is missing", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    await storage.put("ax1", 7);
    await storage.put("ax2", 8);

    const result = await storage.list<number>({prefix: "ax", reverse: true});
    expect(keysFromMap(result)).toEqual(["ax2", "ax1"]);
});

test("list supports prefix with reverse and start boundary", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({
        prefix: "a",
        reverse: true,
        start: "aa",
    });
    expect(keysFromMap(result)).toEqual(["ab", "aa"]);
});

test("list respects limit", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({limit: 2});
    expect(keysFromMap(result)).toEqual(["a", "aa"]);
});

test("list supports start and end when keys do not exist", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({start: "aa0", end: "bb"});
    expect(keysFromMap(result)).toEqual(["ab", "b", "ba"]);
});

test("list supports startAfter when the key does not exist", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({startAfter: "aa0"});
    expect(keysFromMap(result)).toEqual(["ab", "b", "ba", "c"]);
});

test("list supports reverse with startAfter when the key does not exist", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({reverse: true, startAfter: "aa0"});
    expect(keysFromMap(result)).toEqual(["c", "ba", "b", "ab"]);
});

test("list respects limit with start", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({start: "ab", limit: 2});
    expect(keysFromMap(result)).toEqual(["ab", "b"]);
});

test("list respects limit with startAfter", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({startAfter: "aa", limit: 2});
    expect(keysFromMap(result)).toEqual(["ab", "b"]);
});

test("list respects limit in reverse order", async () => {
    const storage = new TemporaryDurableObjectStorage();
    await seedStorage(storage);

    const result = await storage.list<number>({reverse: true, limit: 2});
    expect(keysFromMap(result)).toEqual(["c", "ba"]);
});

test("list rejects start and startAfter together", async () => {
    const storage = new TemporaryDurableObjectStorage();

    await expect(storage.list({start: "a", startAfter: "b"})).rejects.toThrow(InvalidArgumentError);
});

test("rollback throws", () => {
    const storage = new TemporaryDurableObjectStorage();

    expect(() => storage.rollback()).toThrow(UnimplementedError);
});
