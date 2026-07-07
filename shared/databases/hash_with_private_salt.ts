import {hmac} from "@noble/hashes/hmac.js";
import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex, utf8ToBytes} from "@noble/hashes/utils.js";

/**
 * HMAC-SHA256 of `value` keyed by a database group's private salt, as lowercase
 * hex.
 *
 * Used to mirror per-table secrets (currently each table's SQLite `table_name`)
 * into main's replicated `_alpine_tables` registry without disclosing them: main
 * replicates to every group member, but the salt lives only in the group's durable
 * object, so members can't dictionary-attack the digests. HMAC with a secret key
 * is a PRF — without the salt the hashes are opaque.
 *
 * The hash column is derived data: the plaintext truth stays in each per-table
 * file, so a lost salt is recoverable in principle — generate a new one and
 * re-hash every table's name from its file (a one-off sweep; no such tooling
 * exists yet).
 *
 * Synchronous on purpose — database actions run synchronously, which rules out
 * WebCrypto's promise-based API; `@noble/hashes` is pure JS and runs identically
 * in workerd, Node, and tests.
 */
export function hashWithPrivateSalt(privateSalt: Uint8Array, value: string): string {
    return bytesToHex(hmac(sha256, privateSalt, utf8ToBytes(value)));
}
