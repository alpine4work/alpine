/**
 * Randomize the order of items in an array. Performs a [Fisher-Yates Shuffle][1].
 * A great visualization of the algorithm is [here][2].
 *
 * [1]: https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
 * [2]: https://bost.ocks.org/mike/shuffle/
 */
export function shuffleArray<Item>(array: Array<Item>): Array<Item> {
    let currentIndex = array.length;
    let randomIndex;

    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        const randomItem = array[randomIndex]!;
        const currentItem = array[currentIndex]!;

        array[currentIndex] = randomItem;
        array[randomIndex] = currentItem;
    }

    return array;
}
