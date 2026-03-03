/**
 * The minimum width:height aspect ratio we support when rendering images. Images
 * with a taller aspect ratio will be cropped. Super tall images start to look bad
 * with our layout engine since either they take over the page (forcing you to
 * scroll) or if we want to keep images to a max height we'd have to start
 * shrinking the image until there's barely any visible width remaining. So instead
 * we limit how tall images can get before we start cropping.
 *
 * Three tall aspect ratios we want to support without cropping:
 *
 * 1. Large phones. The [largest iPhone is 9:19.5][1] (~0.46) which is greater than
 *    21:50 (0.42). We don't want to crop iPhone screenshots.
 *
 * 2. [Ultrawide 21:9 (~0.43) monitors][2]. In case a user has turned their monitor
 *    vertically and took a screenshot. We don't want to crop that screenshot.
 *
 * 3. The [standard for "Big Screen Cinema" (Cinemascope) is 2.35:1][3] (1:2.35 is
 *    ~0.43). While it's unlikely someone would rotate a cinema shot vertically, we
 *    use the inverse of our minimum aspect ratio as our maximum aspect ratio. So
 *    we want to make sure a cinema shot works horizontally without being cropped.
 *
 * 4. Paper print outs. [Letter paper aspect ratio is 17:22][4] (~0.77) which is
 *    greater than 0.42 so letter paper doesn't crop.
 *
 * We picked 21:50 to just barely include Ultrawide monitors. We could do 2:5 which
 * is simpler but we may already be pushing the limits of what can look good
 * visually with 21:50.
 *
 * [1]: https://iosref.com/res#iphone
 * [2]: https://en.wikipedia.org/wiki/Ultrawide_formats
 * [3]: https://elitescreens.com/understanding-aspect-ratio
 * [4]: https://en.wikipedia.org/wiki/Letter_(paper_size)
 */
export const minFilePreviewAspectRatio = 21 / 50;

/**
 * The maximum width:height aspect ratio we support when rendering images. Images
 * with a wider aspect ratio will be cropped. Super wide image start to look bad
 * with our layout engine since they start shrinking (to stay within the document's
 * bounds) until there's barely any visible height.
 *
 * This is a little larger than the aspect ratio of the Alpine logo (current SVG is
 * 719px by 227px). Since it's kinda lame that we can't upload our own logo without
 * cropping. Denominator is 50 so it's easy to see how this value compares to
 * `minFilePreviewAspectRatio` which has the same denominator.
 */
export const maxFilePreviewAspectRatio = 159 / 50;
