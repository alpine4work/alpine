Files we use for testing our image processing in
`server/files/processor/processors/file_processor_service_content_types.test.ts`. File format is
roughly `${source}_${name}.${extension}`. Many files we've converted from their original format to
another format using some image editor program (e.g. `.jpeg` to `.avif` conversion).

Ideally, all examples in this folder are under 100 KB or even better under 50 KB. We take source
images from the internet and shrink them down before making them a test fixture.

Some links to sources we used (not all sources are listed):

-   `blender_*`: Files derived from [Blender's Peach open movie project](https://peach.blender.org/)
    which have a creative commons license. Most notably, the Big Buck Bunny movie.
-   `deel_*`: modified PDFs from the sales team at [Deel](https://www.deel.com/) that we tried
    uploading to Alpine but failed.
-   `file_examples_*`: Files from [File Examples](https://file-examples.com/) a service for
    developers and testers that provides sample documents. e.g. This
    [Microsoft Word sample](https://file-examples.com/index.php/sample-documents-download/sample-doc-download/).
-   `filesampleshub_*`: Files from [FileSamplesHub](https://filesampleshub.com). e.g. This
    [HEIF sample](https://filesampleshub.com/format/image/heif).
-   `haskell_for_all_*`: Haskell sample files from the
    [Haskell for all](https://www.haskellforall.com/2015/10/basic-haskell-examples.html) blog.
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

We also have files created by our engineers prefixed by their GitHub username. For example,
`calebmer_*` or `imjoshin_*`.
