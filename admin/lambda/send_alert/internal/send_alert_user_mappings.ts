import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const ian = "r5xdesn6c45w6ps2ydrybpcc0c" as AccountId;
const rachel = "jttc8n911at1wxt0b8rm75n270" as AccountId;
const caleb = "9mk91mwgrezh497fpptaykzjk0" as AccountId;
const josh = "7dw297xezx6rs6qy4gjh6h5xx4" as AccountId;

/**
 * Maps PagerDuty user ids from webhook payloads to Alpine account ids.
 */
export const pagerDutyIdToAlpineId: Record<string, AccountId> = {
    pkbcc69: ian,
    ph2rbtj: rachel,
    pdt3aew: caleb,
    py904vm: josh,
};

/**
 * Maps GitHub usernames from webhook payloads to Alpine account ids.
 */
export const gitHubUsernameToAlpineId: Record<string, AccountId> = {
    ifitzsimmons: ian,
    rmtobin: rachel,
    calebmer: caleb,
    imjoshin: josh,
};

/**
 * Maps human-readable names from alert payloads to Alpine account ids.
 */
export const nameToAlpineId: Record<string, AccountId> = {
    "ian fitzsimmons": ian,
    "rachel date": rachel,
    "caleb meredith": caleb,
    "josh johnson": josh,
};
