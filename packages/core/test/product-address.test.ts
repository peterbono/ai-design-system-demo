// Products added from their address ("Only its address", Add a product D2): the https origin Bridge keeps, the pages an
// exploration may start from (the product's own site only), the config check and the brief Claude gets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { addressDomain, liveAddressOf, pageOfAddress, productAddressOf, productProblems, startPageBrief } from '../src/products';

test('productAddressOf keeps the https origin of a bare domain or a link, nothing else', () => {
  assert.equal(productAddressOf('posterstudio.com'), 'https://posterstudio.com');
  assert.equal(productAddressOf('  PosterStudio.com/checkout?x=1#top '), 'https://posterstudio.com');
  assert.equal(productAddressOf('https://shop.posterstudio.com/'), 'https://shop.posterstudio.com');
  for (const bad of ['', 'http://posterstudio.com', 'ftp://posterstudio.com', 'javascript:alert(1)', 'localhost', 'https://127.0.0.1', 'posterstudio.com:8080', 'https://me:pw@posterstudio.com', 'poster studio.com', 'posterstudio', 'https://-bad.com']) {
    assert.equal(productAddressOf(bad), null, bad);
  }
  assert.equal(liveAddressOf({ address: 'https://posterstudio.com' }), 'https://posterstudio.com');
  assert.equal(liveAddressOf({}), null);
  assert.equal(addressDomain('https://posterstudio.com'), 'posterstudio.com');
});

test('pageOfAddress accepts only pages of the product own site', () => {
  const at = 'https://posterstudio.com';
  assert.equal(pageOfAddress('posterstudio.com/checkout', at), 'https://posterstudio.com/checkout');
  assert.equal(pageOfAddress('https://www.posterstudio.com/cart?step=2#top', at), 'https://www.posterstudio.com/cart?step=2');
  assert.equal(pageOfAddress('shop.posterstudio.com', at), 'https://shop.posterstudio.com/');
  assert.equal(pageOfAddress('https://posterstudio.com/', 'https://www.posterstudio.com'), 'https://posterstudio.com/');
  for (const bad of ['otherstudio.com/checkout', 'posterstudio.com.evil.com', 'evilposterstudio.com', 'http://posterstudio.com/checkout', 'https://posterstudio.com:444/', '']) {
    assert.equal(pageOfAddress(bad, at), null, bad);
  }
  assert.equal(pageOfAddress('posterstudio.com', null), null);
});

test('productProblems wants an https origin, and the design team code beside it', () => {
  assert.deepEqual(productProblems([{ key: 'poster', name: 'Poster studio', repo: 'acme/poster-studio', address: 'https://posterstudio.com' }]), []);
  assert.match(productProblems([{ key: 'poster', name: 'Poster studio', repo: 'acme/poster-studio', address: 'posterstudio.com' }])[0]!, /address" must be the live product's https address/);
  assert.match(productProblems([{ key: 'poster', name: 'Poster studio', repo: 'acme/poster-studio', address: 'https://posterstudio.com/checkout' }])[0]!, /without a path/);
  assert.match(productProblems([{ key: 'poster', name: 'Poster studio', address: 'https://posterstudio.com' }])[0]!, /needs "repo" too/);
});

test('the JSON schema lists the address like the parser', () => {
  const schema = JSON.parse(readFileSync(new URL('../bridge.config.schema.json', import.meta.url), 'utf8'));
  const address = schema.properties.products.items.properties.address;
  assert.equal(address.type, 'string');
  assert.ok(new RegExp(address.pattern).test('https://posterstudio.com'));
  assert.ok(!new RegExp(address.pattern).test('https://posterstudio.com/checkout'));
  assert.ok(!new RegExp(address.pattern).test('http://posterstudio.com'));
});

test('the start page brief opens the page in the browser and rebuilds it with the library only', () => {
  const b = startPageBrief('https://posterstudio.com/checkout', 'Poster studio');
  assert.match(b, /https:\/\/posterstudio\.com\/checkout/);
  assert.match(b, /Claude in Chrome/);
  assert.match(b, /plain fetch misses/);
  assert.match(b, /ONLY the library's components and tokens/);
  assert.match(b, /bridge_list_components/);
  assert.match(b, /Never copy the site's CSS/);
  assert.match(b, /Then explore the change the designer describes/);
  assert.ok(!b.includes('—'));
  assert.match(startPageBrief('https://posterstudio.com/checkout', 'Poster studio', ' Checkout with a gift option. '), /Then explore this change from that rebuilt page: Checkout with a gift option\.$/);
});
