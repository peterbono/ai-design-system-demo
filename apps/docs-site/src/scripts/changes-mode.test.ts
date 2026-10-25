// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { assertBranchWrites, changesModeOnPage, SuggestOnlyError } from './changes-mode';

const page = (json: string | null) => {
  document.body.innerHTML = json === null ? '' : `<script type="application/json" id="bridge-repo">${json}</script>`;
};

describe('changes mode on the page', () => {
  afterEach(() => page(null));

  it('reads "changes" from the embedded repo config', () => {
    page('{"owner":"o","repo":"r","changes":"direct"}');
    expect(changesModeOnPage()).toBe('direct');
    page('{"owner":"o","repo":"r","changes":"suggest"}');
    expect(changesModeOnPage()).toBe('suggest');
  });

  it('defaults to suggest when the page says nothing or cannot be read', () => {
    page('{"owner":"o","repo":"r"}');
    expect(changesModeOnPage()).toBe('suggest');
    page('{not json');
    expect(changesModeOnPage()).toBe('suggest');
    page(null);
    expect(changesModeOnPage()).toBe('suggest');
  });

  it('refuses branch writes in suggest mode only, with the sentence to show', () => {
    expect(() => assertBranchWrites('add to changes', 'Send your edits as a suggestion instead.', 'suggest')).toThrow(SuggestOnlyError);
    expect(() => assertBranchWrites('add to changes', undefined, 'suggest')).toThrow('This design system takes suggestions, so Bridge does not add to changes here.');
    expect(() => assertBranchWrites('add to changes', undefined, 'direct')).not.toThrow();
    page('{"changes":"direct"}');
    expect(() => assertBranchWrites('add to changes')).not.toThrow();
  });
});
