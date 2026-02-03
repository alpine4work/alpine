/* eslint-disable @typescript-eslint/no-unused-vars */

// Ok
import {foo} from "~/admin/eslint/test/internal/eslint_rule_no_internal_imports_test_1.js";

// Error
// eslint-disable-next-line cyberworlds/no-internal-imports
import {bar} from "~/admin/eslint/test/other/internal/eslint_rule_no_internal_imports_test_2.js";

// Error
// eslint-disable-next-line cyberworlds/no-internal-imports
import {ContentEditorDomParser} from "~/client/web/content/internal/content_editor_dom_parser.js";
