import {OpfsPageStore, type OptimisticUpdate} from "~/client/web/databases/opfs_page_store.js";
import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";

describe("OpfsPageStore.write", () => {
    test("throws when called outside an optimistic update", async () => {
        const store = await OpfsPageStore.create(createInMemoryOpfsDirectoryHandle(), () => null);

        expect(() => store.write(new Uint8Array(sqlitePageSize), 0)).toThrow(
            "OPFS write outside an optimistic update",
        );
    });

    test("writes to the overlay when inside an optimistic update", async () => {
        const writtenIndexes: Array<number> = [];
        const update: OptimisticUpdate = {
            markPageAsWritten(pageIndex) {
                writtenIndexes.push(pageIndex);
            },
        };
        const store = await OpfsPageStore.create(createInMemoryOpfsDirectoryHandle(), () => update);

        const data = new Uint8Array(sqlitePageSize);
        data[0] = 0xab;
        store.write(data, 0);

        expect(store.getOptimisticPage(0)).toEqual(data);
        expect(writtenIndexes).toEqual([0]);
    });
});
