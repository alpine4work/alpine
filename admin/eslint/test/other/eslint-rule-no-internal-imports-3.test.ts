/* eslint-disable @typescript-eslint/no-unused-vars */

// Error
import {foo} from "~/admin/eslint/test/internal/eslint-rule-no-internal-imports-test-1";

// Ok
import {bar} from "~/admin/eslint/test/other/internal/eslint-rule-no-internal-imports-test-2";

// Error
// eslint-disable-next-line no-internal-imports
import {ContentEditorDomParser} from "~/client/content/internal/content-editor-dom-parser";

test("ok", () => {
    expect(true).toEqual(true);
});
