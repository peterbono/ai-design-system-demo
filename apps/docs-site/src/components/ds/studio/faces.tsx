// Illustrated faces for React islands: the drawings (@bridge-ds/react/avatar-illustrated, about 120 kB gzipped) load
// after the first paint, once per page, so the island stays light. Until then the Avatar shows initials.
import { useEffect, useState } from 'react';
import { Avatar } from '@bridge-ds/react';
import type { Person } from '../../../lib/home-model';

/** A person as the home (`avatar`) or the branch review (`avatarUrl`) knows them; `agent` for Claude. */
export type Face = Pick<Person, 'login' | 'name' | 'agent'> & { avatar?: string | null; avatarUrl?: string | null };

type Draw = (seed: string) => string;
let loading: Promise<Draw> | null = null;
let loaded: Draw | null = null;

/** The face drawer once loaded, else null (the Avatar falls back to initials meanwhile). */
export function useFaces(): Draw | null {
  const [draw, setDraw] = useState<Draw | null>(() => loaded);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    loading ??= import('@bridge-ds/react/avatar-illustrated').then((m) => (loaded = m.illustratedAvatarUri));
    loading.then((d) => live && setDraw(() => d)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return draw;
}

/**
 * A person (their photo, else their drawn face seeded by login) or Claude (its own identity), as the DS Avatar. Shared
 * by the home and the Branches list rows (BranchRow `who`), so the same person looks the same everywhere.
 */
export function Who({ p, size = 'md', decorative = true, className }: { p: Face; size?: 'xs' | 'sm' | 'md'; decorative?: boolean; className?: string; /** For AvatarGroup's "+N" names. */ name?: string }) {
  const draw = useFaces();
  if (p.agent) return <Avatar kind="agent" brand="claude" name={p.name} size={size} decorative={decorative} className={className} />;
  const src = p.avatar ?? p.avatarUrl ?? undefined;
  return <Avatar name={p.name} src={src} size={size} decorative={decorative} className={className} fallback="illustrated" seed={p.login} illustration={draw?.(p.login)} />;
}
