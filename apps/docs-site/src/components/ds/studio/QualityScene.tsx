// The Quality scene, a Field Guide drawing: a lighthouse on its rock, its beam sweeping slowly over a calm sea. The
// weather follows the verdict (lib/quality-view.ts Mood): clear when nothing needs you, a band of haze when something
// needs a look, fog when something blocks the library. Ink line art like brand/illustrations.ts: strokes in
// currentColor, fills through data-fill, motion and the weather in styles/quality.css (motion tokens, a static frame
// under reduced motion). Decorative: the verdict next to it says the same thing in words.
//
// Written as its own component so the animated scene of the Studio headers can take it over later: props are only the
// mood and a class.
import type { Mood } from '../../../lib/quality-view';

export interface QualitySceneProps {
  mood: Mood;
  className?: string;
}

const ink = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function QualityScene({ mood, className }: QualitySceneProps) {
  return (
    <svg className={['ill', 'qs', className].filter(Boolean).join(' ')} data-mood={mood} viewBox="0 0 240 160" fill="none" aria-hidden="true" focusable="false">
      {/* The sun, only in clear weather. */}
      <circle className="qs-sun" cx="34" cy="15" r="8" data-fill="paper" {...ink} />
      {/* The beam: one wedge from the lamp, swinging across the lamp (scaleX) so it sweeps from one side to the other. */}
      <path className="qs-beam" d="M120 41.5L234 27Q238 43 234 59L120 44.5Z" />
      {/* Sea: two calm swell lines that drift a little. */}
      <path className="qs-wave" d="M6 128Q22 124 38 128T70 128M150 128Q166 124 182 128T214 128T234 128" {...ink} />
      <path className="qs-wave qs-wave-2" d="M20 142Q36 138 52 142T84 142M136 142Q152 138 168 142T200 142T226 142" {...ink} />
      {/* The rock. */}
      <path d="M72 130Q78 116 94 113L148 113Q162 116 170 130Z" data-fill="paper" {...ink} />
      {/* The tower, tapering, with two painted bands. */}
      <path d="M104 114L108.5 54L131.5 54L136 114Z" data-fill="paper" {...ink} />
      <path d="M106.6 82L133.4 82L134.2 94L105.8 94Z" data-fill="deep" {...ink} />
      <path d="M108 62L132 62" {...ink} />
      <path d="M116 114L116 104Q120 100 124 104L124 114" {...ink} />
      {/* The gallery and the lantern room with its lamp. */}
      <path d="M103 54L137 54L137 49L103 49Z" data-fill="paper" {...ink} />
      <path d="M111 49L111 36L129 36L129 49" data-fill="paper" {...ink} />
      <circle className="qs-lamp" cx="120" cy="43" r="3.2" data-fill="deep" />
      <path d="M108 36L120 25L132 36Z" data-fill="paper" {...ink} />
      <path d="M120 25L120 20" {...ink} />
      {/* Weather: haze is the first band, fog is all three. */}
      <g className="qs-fog">
        <rect className="qs-band qs-band-1" x="28" y="96" width="132" height="10" rx="5" />
        <rect className="qs-band qs-band-2" x="96" y="66" width="140" height="12" rx="6" />
        <rect className="qs-band qs-band-3" x="4" y="40" width="110" height="10" rx="5" />
      </g>
    </svg>
  );
}
