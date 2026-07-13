import type {AccessLevel} from "~/shared/access/access_policy.js";

/**
 * A `getTableAccessLevel` lookup that grants `Manage` on every table — i.e. runs
 * with no per-table access enforcement. Pass this explicitly (instead of a
 * per-account resolver) when the caller genuinely holds authority over the whole
 * database, e.g. a `System` actor. Making the intent a named value keeps "allow
 * everything" out of the type as an implicit `null`.
 */
export function allowAllTableAccess(): AccessLevel {
    return "Manage";
}
