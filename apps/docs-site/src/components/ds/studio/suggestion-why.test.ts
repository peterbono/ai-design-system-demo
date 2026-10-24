import { describe, expect, it } from 'vitest';
import { whyOf } from './SuggestionReview';

describe('the why of a suggestion', () => {
  it('is what the person wrote, without the sections Bridge appends', () => {
    expect(whyOf('Card edges disappear on grey screens.\n\n## Docs to check\n\n- Accordion: token color.border.strong changed.')).toBe('Card edges disappear on grey screens.');
    expect(whyOf('Just a reason.')).toBe('Just a reason.');
    expect(whyOf('')).toBe('');
  });
});
