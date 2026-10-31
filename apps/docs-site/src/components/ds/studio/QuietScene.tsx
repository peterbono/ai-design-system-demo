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

/** The water of the window layout, in pixels from the horizon (y 0) down: one unbroken horizon line across the whole
 * zone, then two broken rows of ripples. Long enough for the widest zone; the zone clips it. */
const WATER_LENGTH = 3200;
const waves = (y: number, run: number, every: number, offset: number) => {
  let d = '';
  for (let x = offset - every; x < WATER_LENGTH; x += every) d += `M${x} ${y}` + 'q10 -3 20 0t20 0'.repeat(run);
  return d;
};

function Water() {
  return (
    <g className="qs-ground">
      <g className="qs-swell qs-swell-3">
        <Ink d={waves(36, 2, 260, 150)} strokeWidth={1.4} />
      </g>
      <g className="qs-swell qs-swell-2">
        <Ink d={waves(18, 3, 200, 40)} strokeWidth={1.6} />
      </g>
      <g className="qs-swell qs-horizon">
        <Ink d={`M-40 0${'q10 -3 20 0t20 0'.repeat(Math.ceil((WATER_LENGTH + 80) / 40))}`} strokeWidth={1.6} />
      </g>
    </g>
  );
}

/** The harbor seen through the window: the viewBox bottom (y 200) is the horizon, its right edge the zone's right
 * edge. The bridge stands on the water in the right third and runs out of frame; the boat rides in the foreground
 * left of it; two gulls cross the sky between them, the sun and a cloud sit above the arch. Nothing reaches left of x 100. */
function HarborWindow() {
  return (
    <>
      <g className="qs-sky">
        <Ink d="M518 40a14 14 0 1 0 28 0a14 14 0 1 0 -28 0Z" fill="paper" />
        <g className="qs-drift">
          <Ink d="M483 63Q478 53 489 51Q492 41 504 44Q512 36 522 44Q534 42 534 54Q540 63 529 63Z" fill="paper" />
        </g>
        <g className="qs-glide">
          <g className="qs-flap">
            <Ink d="M296 50q6 -6 12 0q6 -6 12 0" strokeWidth={1.6} />
          </g>
          <g className="qs-flap qs-flap-late">
            <Ink d="M328 66q4.5 -4.5 9 0q4.5 -4.5 9 0" strokeWidth={1.6} />
          </g>
        </g>
      </g>
      <g className="qs-ground">
        {/* The arch and its hangers, the deck, the near pier on the water, the far pier out of frame. */}
        <Ink d="M390 154Q590 44 790 154" />
        <Ink d="M440 130V154M490 113V154M540 102.5V154M590 99V154M640 102.5V154M690 113V154M740 130V154" strokeWidth={1.4} />
        <Ink d="M380 148L398 147.6L400 202L378 202.4Z" fill="paper" />
        <Ink d="M370 154Q585 156.5 800 154" />
        <Ink d="M389 147.5V76" strokeWidth={1.6} />
        <g className="qs-flag">
          <Ink d="M389 76Q403 75 417 82Q403 89 389 92Z" fill="deep" strokeWidth={1.6} />
        </g>
        <g className="qs-swell qs-swell-2">
          <Ink d="M362 212q5 -2 10 0t10 0M404 214q5 -2 10 0t10 0" strokeWidth={1.4} />
        </g>
      </g>
      <g className="qs-boat">
        <g className="qs-rock">
          <Ink d="M178 166Q175 190 177 216" strokeWidth={1.4} />
          <Ink d="M208 188L178 166" strokeWidth={1.8} />
          <Ink d="M199.6 178a6.4 6.4 0 1 0 12.8 0a6.4 6.4 0 1 0 -12.8 0Z" fill="paper" />
          <Ink d="M206 185V194" />
          <Ink d="M250 194V126" />
          <Ink d="M250 130L250 186L290 186Z" fill="paper" />
          <Ink d="M250 140L250 186L224 186Z" fill="paper" />
          <Ink d="M190 194L298 194L284 210L204 210Z" fill="paper" />
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
  harbor: { viewBox: '0 0 240 120', draw: Harbor, window: { viewBox: '100 0 600 200', draw: HarborWindow } },
  lighthouse: { viewBox: '0 0 240 160', draw: Lighthouse },
} satisfies Record<string, { viewBox: string; draw: () => ReactNode; window?: { viewBox: string; draw: () => ReactNode } }>;

export type QuietSceneName = keyof typeof SCENES;
export type QuietSceneLayout = 'inline' | 'window';

/** The weather of a scene that has one (the lighthouse): clear, haze or fog. */
export type QuietSceneMood = 'clear' | 'haze' | 'fog';

/**
 * `layout="inline"` (default): the drawing as one block of `width`. `layout="window"` (scenes that have a window
 * drawing): the scene fills its positioned parent like a view through a window (styles/quiet-scene.css): water across
 * the whole width along the bottom, the scene anchored bottom right on it and cropped by the right edge. The parent
 * clips it (overflow hidden), keeps its own content above the water and, as an inline-size container, lets the
 * smallest details go when narrow; on a phone only the water stays.
 */
export function QuietScene({
  scene = 'harbor',
  layout = 'inline',
  width = 220,
  className,
  label,
  mood,
}: {
  scene?: QuietSceneName;
  layout?: QuietSceneLayout;
  width?: number;
  className?: string;
  label?: string;
  mood?: QuietSceneMood;
}) {
  const s: { viewBox: string; draw: () => ReactNode; window?: { viewBox: string; draw: () => ReactNode } } = SCENES[scene];
  const a11y = { role: label ? 'img' : undefined, 'aria-label': label, 'aria-hidden': label ? undefined : ('true' as const) };
  if (layout === 'window' && s.window) {
    const View = s.window.draw;
    return (
      <div className={`ill qs qs-window${className ? ` ${className}` : ''}`} data-scene={scene} data-mood={mood} data-layout="window" {...a11y}>
        <svg className="qs-water" fill="none" focusable="false" aria-hidden="true">
          <Water />
        </svg>
        <svg className="qs-view" viewBox={s.window.viewBox} preserveAspectRatio="xMaxYMax meet" fill="none" focusable="false" aria-hidden="true">
          <View />
        </svg>
      </div>
    );
  }
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
      {...a11y}
      focusable="false"
    >
      <Draw />
    </svg>
  );
}
