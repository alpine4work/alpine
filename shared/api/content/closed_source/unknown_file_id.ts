import {assertId} from "~/shared/id/id.open_source.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

// The `FileId` tries to spell "unknown file" with no spaces. We substitute 0 for
// "o" and since "u" is not allowed in IDs we use "n" in place of "u" since "n" is
// an upside down "u". The readable part is placed at the end so the leading zeroes
// set the chronological time component to 0.
//
// In ProseMirror, a `file` node can exist without an attached file (e.g.
// ProseMirror needs to auto-generate `fileRow` content). Instead of exposing
// `null` in the API, we use this well-known ID so developers never see a null
// FileId. API endpoints should return zero-byte `application/octet-stream` content
// for this ID.
//
// NOTE(imjoshin, 2026-05-14): A file item with this ID has been created in the
// production database as a defense against randomly generating a file with this ID
// (same as `unknownAccountId`).
export const unknownFileId = assertId<FileId>("0000000000000000nnkn0wnf1e");
