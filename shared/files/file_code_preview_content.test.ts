/* eslint-disable cyberworlds/string-quotes */

import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";

test("can serialize and deserialize code preview content", () => {
    const space = {type: "String", classes: "", string: " "} as const;

    const content1 = new FileCodePreviewContent([
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "a"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-number", string: "1"},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "b"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-number", string: "2"},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-variableName", string: "console"},
        {type: "String", classes: "tok-operator", string: "."},
        {type: "String", classes: "tok-propertyName", string: "log"},
        {type: "String", classes: "tok-punctuation", string: "("},
        {type: "String", classes: "tok-variableName", string: "a"},
        space,
        {type: "String", classes: "tok-variableName", string: "b"},
        space,
        {type: "String", classes: "tok-punctuation", string: ")"},
        {type: "String", classes: "tok-punctuation", string: ";"},
    ]);

    const content2 = FileCodePreviewContent.schema.serialize(content1);

    expect(encodeBase64(content2 as Uint8Array)).toEqual(
        "DWxldAAAIACgB2EAACAAFz0AACAAFjEAGTsAAQ1sZXQAACAAoAdiAAAgABc9AAAgABYyABk7AAEgY29uc29sZQAXLgAYbG9nABkoACBhAAAgACBiAAAgABkpABk7AA==",
    );

    const content3 = FileCodePreviewContent.schema.deserialize(content2);

    expect(content3.get()).toEqual([
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "a"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-number", string: "1"},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "b"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-number", string: "2"},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-variableName", string: "console"},
        {type: "String", classes: "tok-operator", string: "."},
        {type: "String", classes: "tok-propertyName", string: "log"},
        {type: "String", classes: "tok-punctuation", string: "("},
        {type: "String", classes: "tok-variableName", string: "a"},
        space,
        {type: "String", classes: "tok-variableName", string: "b"},
        space,
        {type: "String", classes: "tok-punctuation", string: ")"},
        {type: "String", classes: "tok-punctuation", string: ";"},
    ]);

    const content4 = FileCodePreviewContent.schema.serialize(content3);

    expect(encodeBase64(content4 as Uint8Array)).toEqual(
        "DWxldAAAIACgB2EAACAAFz0AACAAFjEAGTsAAQ1sZXQAACAAoAdiAAAgABc9AAAgABYyABk7AAEgY29uc29sZQAXLgAYbG9nABkoACBhAAAgACBiAAAgABkpABk7AA==",
    );
});

test("can serialize and deserialize code preview content which includes null terminator", () => {
    const space = {type: "String", classes: "", string: " "} as const;

    const content1 = new FileCodePreviewContent([
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "a"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-string", string: '"foo"'},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "b"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-string", string: '"\u0000bar"'},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-variableName", string: "console"},
        {type: "String", classes: "tok-operator", string: "."},
        {type: "String", classes: "tok-propertyName", string: "log"},
        {type: "String", classes: "tok-punctuation", string: "("},
        {type: "String", classes: "tok-variableName", string: "a"},
        space,
        {type: "String", classes: "tok-variableName", string: "b"},
        space,
        {type: "String", classes: "tok-punctuation", string: ")"},
        {type: "String", classes: "tok-punctuation", string: ";"},
    ]);

    const content2 = FileCodePreviewContent.schema.serialize(content1);

    expect(encodeBase64(content2 as Uint8Array)).toEqual(
        "DWxldAAAIACgB2EAACAAFz0AACAAGyJmb28iABk7AAENbGV0AAAgAKAHYgAAIAAXPQAAIAAbIu+/vWJhciIAGTsAASBjb25zb2xlABcuABhsb2cAGSgAIGEAACAAIGIAACAAGSkAGTsA",
    );

    const content3 = FileCodePreviewContent.schema.deserialize(content2);

    expect(content3.get()).toEqual([
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "a"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-string", string: '"foo"'},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "b"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-string", string: '"\uFFFDbar"'},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-variableName", string: "console"},
        {type: "String", classes: "tok-operator", string: "."},
        {type: "String", classes: "tok-propertyName", string: "log"},
        {type: "String", classes: "tok-punctuation", string: "("},
        {type: "String", classes: "tok-variableName", string: "a"},
        space,
        {type: "String", classes: "tok-variableName", string: "b"},
        space,
        {type: "String", classes: "tok-punctuation", string: ")"},
        {type: "String", classes: "tok-punctuation", string: ";"},
    ]);

    const content4 = FileCodePreviewContent.schema.serialize(content3);

    expect(encodeBase64(content4 as Uint8Array)).toEqual(
        "DWxldAAAIACgB2EAACAAFz0AACAAGyJmb28iABk7AAENbGV0AAAgAKAHYgAAIAAXPQAAIAAbIu+/vWJhciIAGTsAASBjb25zb2xlABcuABhsb2cAGSgAIGEAACAAIGIAACAAGSkAGTsA",
    );

    const content5 = FileCodePreviewContent.schema.deserialize(content4);

    expect(content5.get()).toEqual([
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "a"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-string", string: '"foo"'},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-keyword", string: "let"},
        space,
        {type: "String", classes: "tok-variableName tok-definition", string: "b"},
        space,
        {type: "String", classes: "tok-operator", string: "="},
        space,
        {type: "String", classes: "tok-string", string: '"\uFFFDbar"'},
        {type: "String", classes: "tok-punctuation", string: ";"},
        {type: "Newline"},
        {type: "String", classes: "tok-variableName", string: "console"},
        {type: "String", classes: "tok-operator", string: "."},
        {type: "String", classes: "tok-propertyName", string: "log"},
        {type: "String", classes: "tok-punctuation", string: "("},
        {type: "String", classes: "tok-variableName", string: "a"},
        space,
        {type: "String", classes: "tok-variableName", string: "b"},
        space,
        {type: "String", classes: "tok-punctuation", string: ")"},
        {type: "String", classes: "tok-punctuation", string: ";"},
    ]);

    const content6 = FileCodePreviewContent.schema.serialize(content5);

    expect(encodeBase64(content6 as Uint8Array)).toEqual(
        "DWxldAAAIACgB2EAACAAFz0AACAAGyJmb28iABk7AAENbGV0AAAgAKAHYgAAIAAXPQAAIAAbIu+/vWJhciIAGTsAASBjb25zb2xlABcuABhsb2cAGSgAIGEAACAAIGIAACAAGSkAGTsA",
    );
});
