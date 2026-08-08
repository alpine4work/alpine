import {AccountId} from "~/shared/id/types/id_types.open_source.js";

export const calebKnownAccountId = "9mk91mwgrezh497fpptaykzjk0" as AccountId;
export const ianKnownAccountId = "r5xdesn6c45w6ps2ydrybpcc0c" as AccountId;
export const joshKnownAccountId = "7dw297xezx6rs6qy4gjh6h5xx4" as AccountId;
export const rachelKnownAccountId = "jttc8n911at1wxt0b8rm75n270" as AccountId;

export const alpioneers = {
    [calebKnownAccountId]: "caleb",
    [ianKnownAccountId]: "ian",
    [joshKnownAccountId]: "josh",
    [rachelKnownAccountId]: "rachel",
} as const;
export type Alpioneer = (typeof alpioneers)[keyof typeof alpioneers];
