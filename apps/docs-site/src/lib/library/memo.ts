// One computation per model: the Library libs are pure functions of a RepoModel, cached per model object.
import type { RepoModel } from '@bridge-ds/core';

export function perModel<T>(fn: (model: RepoModel) => T): (model: RepoModel) => T {
  const cache = new WeakMap<RepoModel, T>();
  return (model) => {
    if (!cache.has(model)) cache.set(model, fn(model));
    return cache.get(model)!;
  };
}
