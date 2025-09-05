// This file is a duplicate of `shared/content/content_code_block_language_id.ts`
// because we want to open source this code someday so we don't want to add
// `shared/content` as a dependency.

import {ApiContentCodeBlockElement} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";

export const apiContentCodeBlockElementLanguages = new Set(
    getObjectKeysWithKeyofType(
        // Use a TypeScript `Record` so if new languages are added TypeScript forces us
        // to update this object.
        cast<Record<ApiContentCodeBlockElement["language"], true>>({
            text: true,
            javascript: true,
            html: true,
            css: true,
            sql: true,
            python: true,
            typescript: true,
            shell: true,
            java: true,
            json: true,
            markdown: true,
            csharp: true,
            cpp: true,
            c: true,
            php: true,
            go: true,
            yaml: true,
            powershell: true,
            rust: true,
            kotlin: true,
            ruby: true,
            lua: true,
            xml: true,
            dart: true,
            swift: true,
            assembly: true,
            webassembly: true,
            scala: true,
            r: true,
            elixir: true,
            objectivec: true,
            perl: true,
            haskell: true,
            solidity: true,
            clojure: true,
            erlang: true,
            ocaml: true,
        }),
    ),
);

export function isApiContentCodeBlockElementLanguage(
    string: string,
): string is ApiContentCodeBlockElement["language"] {
    return apiContentCodeBlockElementLanguages.has(
        // @ts-expect-error: TypeScript wants the type of `has()` to be assignable to
        // the set value.
        string,
    );
}
