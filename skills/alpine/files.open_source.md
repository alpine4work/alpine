# Files

Users upload all kinds of different files to Alpine. Images, video, audio, PDFs, code, and more. Files can be present in [rich text content](content.md) or attached to the very end of [messages](messaging.md).

When you `read` a `/file/...` path you get back the full file! You must pass a `limit` (optional, defaults to 20kb) to `read` that’s larger than the file size otherwise you’ll get an error. If you perform a `read` with a `limit` that’s too small then you’ll get an error telling you the file’s actual size and you can choose whether or not you want to download the file.

Markdown for an image looks like this:

```md
![Cat meme](/file/cat-meme.png)
```

We try to generate a caption for images (in this case the caption is “Cat meme”) so you can understand what’s inside the image even before you read it.

Sometimes the markdown for an image will look like this:

```md
<img alt="Cat meme" src="/file/cat-meme.png" />
```

Markdown for a video looks like this:

```md
<video aria-label="Cat stretching" src="/file/cat-stretching.mp4"></video>
```

…and markdown for audio looks like this:

```md
<audio aria-label="Cat purring" src="/file/cat-purring.m4a"></audio>
```

Markdown for any other file (PDF, code, etc.) looks like this:

```md
<object data="/file/file.pdf"></object>
```

The file extension communicates the content type of the file (we use `.bin` when we can’t figure out the type of a file).

## Galleries

When a user drags/drops files onto each other it automatically creates a beautiful gallery. With images laid out nicely on the page preserving their aspect ratio. Galleries look like this:

```md
<div style="display: flex">
<img alt="Image 1" src="/file/image-1.png" />
<img alt="Image 2" src="/file/image-2.png" />
</div>

<div style="display: flex">
<img alt="Image 3" src="/file/image-3.png" />
<img alt="Image 4" src="/file/image-4.png" />
<img alt="Image 5" src="/file/image-5.png" />
</div>
```

This is a gallery of 5 images in two rows. A gallery is made up of adjacent “file rows”. A file row can have 1-3 files. A file row with 2-3 images will always be a `<div style="display: flex">` element. You can think of a file without a wrapping `<div>` as a file row with a single file in it.

So this renders in the UI as a gallery with six images (between the “Check out my gallery…Isn’t it nice” text content):

```md
Check out my gallery:

![Image 1](/file/image-1.png)

<div style="display: flex">
<img alt="Image 2" src="/file/image-2.png" />
<img alt="Image 3" src="/file/image-3.png" />
</div>

![Image 4](/file/image-4.png)

<div style="display: flex">
<img alt="Image 5" src="/file/image-5.png" />
<img alt="Image 6" src="/file/image-6.png" />
</div>

Isn’t it nice?
```

You can put any file in a gallery. You must use `<img>` HTML syntax when putting an image in a gallery row `<div>` (markdown syntax not supported).

You can also put preview embeds of stuff in Alpine in a gallery! In the [content](content.md) skill file we discuss how:

```md
![My Document](/document/my-document)
```

…will render a preview embed of the document. You can also create a preview embed of a document like this:

```md
<img alt="My Document" src="/document/my-document" />
```

…and put it in a gallery like this:

```md
<div style="display: flex">
<img alt="My Document 1" src="/document/my-document-1" />
<img alt="My Document 2" src="/document/my-document-2" />
</div>
```

…you can even put it in a gallery alongside files:

```md
<div style="display: flex">
<img alt="My Document" src="/document/my-document" />
<video aria-label="Cat stretching" src="/file/cat-stretching.mp4"></video>
</div>
```

To help your mental model, let’s go over this information again:

- A plain file not wrapped in a `<div>` is a file row with one file in it.
- A file row can have one to three files which are rendered next to each other horizontally.
- A file row with two to three files must be a `<div style="display: flex">` which wraps files in HTML format.
- Adjacent file rows are rendered together in one file gallery in the UI.
- You can create previews for things in Alpine by using the same syntax as image files and these previews can be used in file rows/galleries.
