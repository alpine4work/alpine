import {fileContentTypes, normalizeContentType} from "~/shared/files/file_content_type.js";

test("can normalize content type", () => {
    expect(normalizeContentType("Text/HTML")).toEqual("text/html");
    expect(normalizeContentType('Text/HTML;Charset="utf-8"')).toEqual("text/html;charset=utf-8");
    expect(normalizeContentType('Text/HTML;Charset="UTF-8"')).toEqual("text/html;charset=utf-8");
    expect(normalizeContentType("text/html; charset=UTF-8")).toEqual("text/html;charset=utf-8");
    expect(normalizeContentType("text/html;   charset=UTF-8")).toEqual("text/html;charset=utf-8");
    expect(normalizeContentType("multipart/form-data; boundary=ExampleBoundaryString")).toEqual(
        "multipart/form-data;boundary=ExampleBoundaryString",
    );
    expect(normalizeContentType('multipart/form-data; boundary="ExampleBoundaryString"')).toEqual(
        "multipart/form-data;boundary=ExampleBoundaryString",
    );
});

test("all file content types are normalized", () => {
    expect(Array.from(fileContentTypes, contentType => normalizeContentType(contentType))).toEqual(
        Array.from(fileContentTypes),
    );
});
