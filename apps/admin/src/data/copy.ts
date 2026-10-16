/**
 * The generator writes Latin placeholder text. These short English lines replace it so reviews and
 * product descriptions read like a real shop. Picks are deterministic (by record id).
 */
const BY_RATING: Record<number, string[]> = {
  5: [
    'Colors are even richer than on the screen.',
    'Arrived well packed and the paper feels premium.',
    'Exactly what I hoped for. It is the first thing guests notice.',
    'Second order from this shop and still impressed.',
    'Sharp print, true to size, fast delivery.',
    'Framed it the day it arrived. Looks great above the desk.',
  ],
  4: [
    'Lovely print. Delivery took a couple of days longer than announced.',
    'Great quality overall, the colors are slightly warmer than expected.',
    'Very happy with it. A size guide with a sofa for scale would help.',
    'Nice paper and clean edges. The tube was a bit dented.',
  ],
  3: [
    'Decent print, but the blacks look a little flat.',
    'Fine for the price. I expected thicker paper.',
    'Good image, though it took over a week to arrive.',
  ],
  2: [
    'The corner was creased when it arrived.',
    'Colors are noticeably duller than the photo on the site.',
    'Ordered the large size and it looks slightly pixelated up close.',
  ],
  1: [
    'Arrived torn. Still waiting for an answer from support.',
    'Wrong print in the tube. I would like an exchange.',
    'Never received the parcel, tracking stopped after two days.',
  ],
};

export function reviewComment(id: number, rating: number): string {
  const pool = BY_RATING[Math.min(5, Math.max(1, Math.round(rating)))] ?? BY_RATING[3]!;
  const first = pool[id % pool.length]!;
  const second = pool[(id * 7 + 3) % pool.length]!;
  return id % 3 === 0 || first === second ? first : `${first} ${second}`;
}

const FINISH = ['archival matte paper', 'satin photo paper', 'heavyweight cotton rag', 'fine art gloss paper'];
const SHIPPING = ['Ships rolled in a tube within 2 business days.', 'Ships flat with corner protectors.', 'Printed to order and shipped within 3 business days.'];

export function productDescription(id: number, reference: string, width: number, height: number): string {
  return `${reference}, printed on ${FINISH[id % FINISH.length]}, ${width} x ${height} cm. ${SHIPPING[id % SHIPPING.length]}`;
}
