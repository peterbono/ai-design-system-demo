#!/usr/bin/env node
// Renames the workspace packages to the publishable npm scope, in every tracked text file.
//   @demo-ds/*  -> @bridge-ds/*
//   @bridge/*   -> @bridge-ds/*   (`@bridge` is an existing npm org we do not own)
// Idempotent, so a long-lived branch can run it again after a rebase:
//   node scripts/rename-scope.mjs          rewrite files
//   node scripts/rename-scope.mjs --check  exit 1 if an old name is left (CI-friendly)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const check = process.argv.includes('--check');
const SKIP = [/^apps\/admin\/_original\//, /^scripts\/rename-scope\.mjs$/, /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|mp4|zip|gz)$/i];

// Plain and regex-escaped forms (`@demo-ds\/react` inside a RegExp literal).
const RULES = [
  [/@demo-ds(\\?\/)/g, '@bridge-ds$1'],
  [/@bridge(\\?\/)(core|mcp|cli|react|tokens|preview)\b/g, '@bridge-ds$1$2'],
];

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => f && !SKIP.some((re) => re.test(f)));
const changed = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  let next = text;
  for (const [re, to] of RULES) next = next.replace(re, to);
  if (next === text) continue;
  changed.push(file);
  if (!check) writeFileSync(file, next);
}

if (check) {
  if (changed.length) {
    console.error(`rename-scope: old package names left in ${changed.length} file(s):\n  ${changed.join('\n  ')}`);
    process.exit(1);
  }
  console.log('rename-scope: all package names use @bridge-ds');
} else {
  console.log(`rename-scope: rewrote ${changed.length} file(s)`);
}
