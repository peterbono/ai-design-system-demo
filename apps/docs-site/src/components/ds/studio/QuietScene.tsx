// A Field Guide scene that breathes: the ink drawing draws itself in once, then rests in a slow idle loop (water
// swell, a moored boat rocking, a cloud drifting, a flag lifting). For the calm moments of the product, when nothing
// waits on the viewer: Studio Home today, other empty states later (pass another `scene`). Motion and colors live in
// styles/quiet-scene.css (motion tokens only, still under prefers-reduced-motion). Decorative unless `label` is given.
import type { ReactNode, SVGProps } from 'react';
import '../../../styles/quiet-scene.css';

/** One ink stroke. pathLength 1 lets the draw-in run the same on every line, whatever its length. */
function Ink({ fill, ...rest }: SVGProps<SVGPathElement> & { fill?: 'paper' | 'zone' | 'deep' }) {
  return <path pathLength={1} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill={fill ? undefined : 'none'} data-fill={fill} {...rest} />;
}

/** A row of ripples: `n` humps of 20 units from (x, y). */
const ripples = (x: number, y: number, n: number) => `M${x} ${y}` + 'q5 -4 10 0t10 0'.repeat(n);

/** A calm harbor: the bridge with its flag, a sailboat moored with someone fishing, a cloud passing the sun, two gulls. */
function Harbor() {
  return (
    <>
      {/* The sky draws last: the ground first, then the boat, then the air. */}
      <g className="qs-sky">
        <Ink d="M205 26C205 31 201 35 196 35C191 35 187 31 187 26C187 21 191 17 196 17C201 17 205 21 205 26Z" fill="paper" />
        <g className="qs-drift">
          <Ink d="M152 37Q149 31 156 30Q158 24 165 26Q170 21 176 26Q183 25 183 32Q186 37 180 37Z" fill="paper" />
        </g>
        <g className="qs-glide">
          <g className="qs-flap">
            <Ink d="M64 26q4 -4 8 0q4 -4 8 0" strokeWidth={1.6} />
          </g>
          <g className="qs-flap qs-flap-late">
            <Ink d="M86 36q3 -3 6 0q3 -3 6 0" strokeWidth={1.6} />
          </g>
        </g>
      </g>
      <g className="qs-ground">
        <g className="qs-swell">
          <Ink d={ripples(20, 109, 8)} strokeWidth={1.6} />
        </g>
        <g className="qs-swell qs-swell-2">
          <Ink d={ripples(128, 102, 4)} strokeWidth={1.6} />
        </g>
        <g className="qs-swell qs-swell-3">
          <Ink d={ripples(70, 116, 7)} strokeWidth={1.6} />
        </g>
        <Ink d="M120 86Q170 48 220 86" />
        <Ink d="M140 74V86M155 69V86M170 67V86M185 69V86M200 74V86" strokeWidth={1.4} />
        <Ink d="M116 80L124 79.8L125 106L115 106.2Z" fill="paper" />
        <Ink d="M216 80L224 79.8L225 106L215 106.2Z" fill="paper" />
        <Ink d="M110 86Q168 87.5 230 86" />
        <Ink d="M220 80V58" strokeWidth={1.6} />
        <g className="qs-flag">
          <Ink d="M220 58Q227 57.5 234 61Q227 64.5 220 66Z" fill="deep" strokeWidth={1.6} />
        </g>
      </g>
      <g className="qs-boat">
        <g className="qs-rock">
          <Ink d="M20 82Q18.5 94 19.5 107" strokeWidth={1.2} />
          <Ink d="M35 93L20 82" strokeWidth={1.6} />
          <Ink d="M37.2 88C37.2 89.8 35.8 91.2 34 91.2C32.2 91.2 30.8 89.8 30.8 88C30.8 86.2 32.2 84.8 34 84.8C35.8 84.8 37.2 86.2 37.2 88Z" fill="paper" />
          <Ink d="M34 91.5V96" />
          <Ink d="M56 96V62" />
          <Ink d="M56 64L56 92L76 92Z" fill="paper" />
          <Ink d="M56 69L56 92L43 92Z" fill="paper" />
          <Ink d="M26 96L80 96L73 104L33 104Z" fill="paper" />
        </g>
      </g>
    </>
  );
}

/**
 * Studio Quality: a lighthouse on its rock, its beam sweeping slowly over the sea. The weather follows the verdict
 * (`mood`, lib/quality-view.ts): the sun when clear, a band of haze when something needs a look, fog when something
 * blocks the library. Weather and beam: the lighthouse block of styles/quiet-scene.css.
 */
function Lighthouse() {
  return (
    <>
      <g className="qs-sky">
        <Ink className="qs-lh-sun" d="M42 15A8 8 0 1 1 26 15A8 8 0 1 1 42 15Z" fill="paper" />
      </g>
      {/* One wedge from the lamp, swinging across it (scaleX) so it sweeps from one side to the other. */}
      <path className="qs-lh-beam" d="M120 41.5L234 27Q238 43 234 59L120 44.5Z" />
      <g className="qs-ground">
        <g className="qs-swell">
          <Ink d={ripples(6, 128, 3) + ripples(150, 128, 4)} strokeWidth={1.6} />
        </g>
        <g className="qs-swell qs-swell-2">
          <Ink d={ripples(20, 142, 3) + ripples(136, 142, 4)} strokeWidth={1.6} />
        </g>
        <Ink d="M72 130Q78 116 94 113L148 113Q162 116 170 130Z" fill="paper" />
        <Ink d="M104 114L108.5 54L131.5 54L136 114Z" fill="paper" />
        <Ink d="M106.6 82L133.4 82L134.2 94L105.8 94Z" fill="deep" />
        <Ink d="M108 62L132 62" />
        <Ink d="M116 114L116 104Q120 100 124 104L124 114" />
        <Ink d="M103 54L137 54L137 49L103 49Z" fill="paper" />
        <Ink d="M111 49L111 36L129 36L129 49" fill="paper" />
        <Ink d="M123.2 43A3.2 3.2 0 1 1 116.8 43A3.2 3.2 0 1 1 123.2 43Z" fill="deep" />
        <Ink d="M108 36L120 25L132 36Z" fill="paper" />
        <Ink d="M120 25L120 20" />
      </g>
      {/* Weather: haze is the first band, fog is all three. */}
      <g className="qs-lh-fog">
        <rect className="qs-lh-band qs-lh-band-1" x="28" y="96" width="132" height="10" rx="5" />
        <rect className="qs-lh-band qs-lh-band-2" x="96" y="66" width="140" height="12" rx="6" />
        <rect className="qs-lh-band qs-lh-band-3" x="4" y="40" width="110" height="10" rx="5" />
      </g>
    </>
  );
}

const SCENES = {
  harbor: { viewBox: '0 0 240 120', draw: Harbor },
  lighthouse: { viewBox: '0 0 240 160', draw: Lighthouse },
} satisfies Record<string, { viewBox: string; draw: () => ReactNode }>;

export type QuietSceneName = keyof typeof SCENES;

/** The weather of a scene that has one (the lighthouse): clear, haze or fog. */
export type QuietSceneMood = 'clear' | 'haze' | 'fog';

export function QuietScene({
  scene = 'harbor',
  width = 220,
  className,
  label,
  mood,
}: {
  scene?: QuietSceneName;
  width?: number;
  className?: string;
  label?: string;
  mood?: QuietSceneMood;
}) {
  const s = SCENES[scene];
  const [, , bw, bh] = s.viewBox.split(' ').map(Number);
  const Draw = s.draw;
  return (
    <svg
      className={`ill qs${className ? ` ${className}` : ''}`}
      data-scene={scene}
      data-mood={mood}
      width={width}
      height={Math.round((width * bh!) / bw!)}
      viewBox={s.viewBox}
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      <Draw />
    </svg>
  );
}
