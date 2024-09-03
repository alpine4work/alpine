Files we use for testing our image processing in
`server/files/upload/file_upload_service_content_types.test.ts`. File format is roughly
`${source}_${name}.${extension}`. Many files we've converted from their original format to another
format using some image editor program (e.g. `.jpeg` to `.avif` conversion).

Some links to sources we used (not all sources are listed):

-   `filesampleshub_*`: Files from [FileSamplesHub](https://filesampleshub.com). e.g. This
    [HEIF sample](https://filesampleshub.com/format/image/heif).
-   `iphone_${photographer}_*`: Photos taken from an iPhone. Includes the name of the photographer
    (e.g. `calebmer` for Caleb Meredith)
-   `iup_*`: From Indiana University of Pennsylvania. We use their IT department's
    [test PDF document](https://www.cte.iup.edu/cte/Resources/PDF_TestPage.pdf).
-   `pdfsharp_sample_*`: Samples from the PDFsharp PDF toolkit for C#. e.g. This
    [multi-page size file](https://www.pdfsharp.net/wiki/Print.aspx?Page=PageSizes-sample&AspxAutoDetectCookieSupport=1).
-   `py_pdf_sample_*`: From the [`py-pdf/sample-files`](https://github.com/py-pdf/sample-files)
    repository on GitHub.
-   `undraw_*`: From [Undraw](https://undraw.co).
-   `unsplash_*`: From [Unsplash](https://unsplash.com). We include the Unsplash identifier in the
    file name so you can find it on Unsplash's website.
-   `wikimedia_*`: Files from the Wikimedia (a.k.a. Wikipedia) family of websites. e.g. This
    [PNG transparency demonstration file](https://en.m.wikipedia.org/wiki/File:PNG_transparency_demonstration_1.png).
