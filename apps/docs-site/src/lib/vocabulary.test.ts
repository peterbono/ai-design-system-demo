import { describe, expect, it } from 'vitest';
import { branchCount, branchWithJiraKey, isJiraKey, jargonIn, jiraKeyOf, parseJiraKey, STATUS_WORDS, titleWithJiraKey, VOCAB, withoutJiraKey } from './vocabulary';

describe('vocabulary', () => {
  it('speaks changes and the library, never git', () => {
    expect(VOCAB.createBranch).toBe('Start a change');
    expect(VOCAB.requestReview).toBe('Send for review');
    expect(VOCAB.updateFromMain).toBe('Update from the library');
    expect(VOCAB.reviewAndMerge).toBe('Review and add to the library');
    expect(VOCAB.merge).toBe('Add to the library');
    expect(VOCAB.readyToMerge).toBe('Ready to add to the library');
    expect(VOCAB.Branches).toBe('Changes');
    expect(STATUS_WORDS.inReview).toBe('In review');
    expect(STATUS_WORDS.merged).toBe('Added to the library');
    expect(branchCount(1)).toBe('1 change');
    expect(branchCount(3)).toBe('3 changes');
    for (const w of Object.values(VOCAB)) expect(jargonIn(w)).toEqual([]);
  });

  it('finds developer words, git ones included', () => {
    expect(jargonIn('Open the pull request')).toEqual(['pull', 'pull request']);
    expect(jargonIn('3 commits behind, PR #12, CI failed')).toEqual(['commit', 'PR', 'CI']);
    expect(jargonIn('Add a changeset')).toEqual(['changeset']);
    expect(jargonIn('Review and merge this branch into main')).toEqual(['branch', 'merge', 'main']);
    expect(jargonIn('Merged branches, merging')).toEqual(['branch', 'merge']);
    expect(jargonIn('Review and add this change to the library')).toEqual([]);
    expect(jargonIn('Precise prices, pushy copy, social')).toEqual([]);
    expect(jargonIn('Shape and size, the main domain')).toEqual(['main']);
    expect(jargonIn('Remains, domains, emerge')).toEqual([]);
  });
});

describe('Jira keys', () => {
  it('normalises a key and explains a bad one', () => {
    expect(parseJiraKey(' ds-42 ')).toBe('DS-42');
    expect(parseJiraKey('')).toBeNull();
    expect(parseJiraKey(undefined)).toBeNull();
    expect(() => parseJiraKey('DS 42')).toThrow(/like DS-42/);
    expect(() => parseJiraKey('DS-0')).toThrow();
    expect(isJiraKey('web2-7')).toBe(true);
    expect(isJiraKey('42')).toBe(false);
  });

  it('puts the key first in the title and the branch name', () => {
    expect(titleWithJiraKey('tokens: darker primary', 'DS-42')).toBe('DS-42 tokens: darker primary');
    expect(titleWithJiraKey('DS-42 tokens: darker primary', 'DS-42')).toBe('DS-42 tokens: darker primary');
    expect(titleWithJiraKey('tokens: darker primary', null)).toBe('tokens: darker primary');
    expect(branchWithJiraKey('tokens/darker-primary-20261019-1200', 'DS-42')).toBe('tokens/DS-42-darker-primary-20261019-1200');
    expect(branchWithJiraKey('docs-button', 'DS-7')).toBe('DS-7-docs-button');
    expect(branchWithJiraKey('tokens/x', null)).toBe('tokens/x');
  });

  it('reads the key back from a title', () => {
    expect(jiraKeyOf('DS-42 tokens: darker primary')).toBe('DS-42');
    expect(jiraKeyOf('[DS-42] Darker primary')).toBe('DS-42');
    expect(jiraKeyOf('DS-42: Darker primary')).toBe('DS-42');
    expect(jiraKeyOf('tokens: darker primary')).toBeNull();
    expect(jiraKeyOf('Release v1.2')).toBeNull();
    expect(withoutJiraKey('DS-42 tokens: darker primary')).toBe('tokens: darker primary');
  });
});
