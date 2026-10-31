// A Field Guide scene that breathes: the ink drawing draws itself in once, then rests in a slow idle loop. For the
// calm moments of the product: the quiet Studio Home (harbor: water swell, a moored boat rocking, a cloud drifting, a
// flag lifting), Studio Quality's verdict (lighthouse, its weather following the verdict), and the Studio page headers, one scene per section (StudioHeader.astro, StudioHead.tsx):
//   changes     paths that branch off the main one, drawing themselves, a flag at the end
//   building    scaffolding and a little crane, its hook gliding along the jib
//   components  stacked blocks, the top ones floating
//   tokens      a swatch fan breathing open around its rivet, a light and dark disc turning
//   settings    a ship's wheel turning a little each way, a compass needle settling
// Motion and colors live in styles/quiet-scene.css (motion tokens only, still under prefers-reduced-motion).
// Decorative unless `label` is given.
import type { ReactNode, SVGProps } from 'react';
import '../../../styles/quiet-scene.css';

/** One ink stroke. pathLength 1 lets the draw-in run the same on every line, whatever its length. */
function Ink({ fill, ...rest }: SVGProps<SVGPathElement> & { fill?: 'paper' | 'zone' | 'deep' }) {
  return <path pathLength={1} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill={fill ? undefined : 'none'} data-fill={fill} {...rest} />;
}

/** A round ink shape (a node, a rivet, a lamp). */
function Dot({ fill, ...rest }: SVGProps<SVGCircleElement> & { fill?: 'paper' | 'zone' | 'deep' }) {
  return <circle stroke="currentColor" strokeWidth={2} fill={fill ? undefined : 'none'} data-fill={fill} {...rest} />;
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

/** The ground line of the section scenes (viewBox 0 0 160 96). */
const Ground = () => <Ink d="M6 87Q80 85.6 154 87" />;

/** Changes: branches draw themselves off the main path, a flag at the end of the longest. */
function Changes() {
  return (
    <>
      <Ground />
      <Ink d="M12 70Q80 67.5 148 70" />
      <Ink className="qs-branch" d="M42 69.2C60 68 64 40 92 37.5Q114 35.6 136 33" />
      <Ink className="qs-branch qs-branch-2" d="M78 68.6C94 67.6 98 53 124 51.5" />
      <Ink className="qs-branch qs-branch-3" d="M100 37C108 36 110 22 126 19.5" />
      <Dot cx={42} cy={69.2} r={3.4} fill="paper" />
      <Dot cx={78} cy={68.6} r={3.4} fill="paper" />
      <Dot cx={148} cy={70} r={3.4} fill="deep" />
      <Dot cx={124} cy={51.5} r={3} fill="zone" />
      <Dot cx={126} cy={19.5} r={2.6} fill="paper" />
      <Ink d="M136 33V13" strokeWidth={1.6} />
      <g className="qs-flag">
        <Ink d="M136 13Q143 12.5 150 16Q143 19.5 136 21Z" fill="zone" strokeWidth={1.6} />
      </g>
    </>
  );
}

/** Being built: scaffolding with walls going up, a crane whose hook glides along the jib. */
function Building() {
  return (
    <>
      <Ground />
      <Ink d="M20 87V50M46 87V50M72 87V50M18 50.4H74M18 68.2H74" />
      <Ink d="M20 68.2L46 50.4M46 68.2L72 50.4" strokeWidth={1.4} />
      <Ink d="M22.2 71L43.8 70.8L44 85.4L22.1 85.6Z" fill="zone" />
      <Ink d="M48.2 71.1L69.8 70.9L69.7 85.5L48.3 85.4Z" fill="paper" />
      <Ink d="M22.1 54.2L43.9 54L43.8 66.2L22.3 66.4Z" fill="paper" />
      <Ink d="M102 87V18M110 87V18" />
      <Ink d="M102 80L110 72L102 64L110 56L102 48L110 40L102 32L110 24" strokeWidth={1.4} />
      <Ink d="M86 18H152M106 18V9M106 9L88 18M106 9L150 18" />
      <Ink d="M87.6 18.2L97.8 18.1L97.6 25L87.8 25.2Z" fill="zone" />
      <g className="qs-trolley">
        <Ink d="M128.8 16.2H135.2" strokeWidth={3} />
        <g className="qs-hook">
          <Ink d="M132 18V42" strokeWidth={1.4} />
          <Ink d="M126.1 42.1L137.9 41.9L138 50.6L125.9 50.4Z" fill="paper" />
        </g>
      </g>
    </>
  );
}

/** Components: stacked blocks; the top ones float above the stack and settle back. */
function Components() {
  return (
    <>
      <Ground />
      <Ink d="M38.2 64.1L97.9 63.8L98.1 86.2L37.9 86Z" fill="paper" />
      <Ink d="M48.1 44.2L88 43.9L87.9 63.6L48.2 63.8Z" fill="zone" />
      <Ink d="M56 50.5H80" strokeWidth={1.4} />
      <g className="qs-float">
        <Ink d="M56.2 22.1L80.1 21.9L79.9 38.2L56 38Z" fill="paper" />
        <Ink d="M61 30.2h14" strokeWidth={1.4} />
      </g>
      <Ink d="M106.1 72.1L123.9 71.9L124 86L106 86.1Z" fill="zone" />
      <Ink d="M126 72L143.8 72.2L143.9 86.1L126.2 86Z" fill="paper" />
      <g className="qs-float qs-float-2">
        <Ink d="M114.1 52.2L131.9 51.9L132.1 65.8L114 66Z" fill="paper" />
      </g>
      <Ink d="M14.1 74.1L29.9 73.9L30 86.1L13.9 86Z" fill="paper" />
    </>
  );
}

/** Tokens: a swatch fan breathing open around its rivet, one Deep Harbor chip; a light and dark disc. */
function Tokens() {
  return (
    <>
      <Ground />
      {[-48, -24, 0, 24, 48].map((a, i) => (
        <g key={a} transform={`rotate(${a} 58 80)`}>
          <g className={`qs-fan qs-fan-${i}`}>
            <Ink d="M47.2 26.2L68.8 25.8L69 80.2L47 80Z" fill="paper" />
            <Ink d="M47.6 26.4L68.6 26.1L68.7 46.2L47.5 46.4Z" fill={i === 2 ? 'deep' : i % 2 ? 'zone' : 'paper'} />
            <Ink d="M52 54h12M52 60h8" strokeWidth={1.4} />
          </g>
        </g>
      ))}
      <Dot cx={58} cy={80} r={3.2} fill="paper" />
      <g className="qs-turn">
        <Dot cx={130} cy={38} r={13} fill="paper" />
        <Ink d="M130 25A13 13 0 0 1 130 51Z" fill="zone" />
      </g>
    </>
  );
}

/** Settings: a ship's wheel turning a little each way, a compass whose needle settles. */
function Settings() {
  return (
    <>
      <g className="qs-wheel">
        <Dot cx={66} cy={48} r={24} fill="paper" />
        <Dot cx={66} cy={48} r={18.5} />
        {[0, 45, 90, 135].map((a) => (
          <Ink key={a} d="M66 13.4V82.6" transform={`rotate(${a} 66 48)`} />
        ))}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <Dot key={a} cx={66} cy={12.4} r={2.6} fill="paper" transform={`rotate(${a} 66 48)`} />
        ))}
        <Dot cx={66} cy={48} r={5.5} fill="zone" />
      </g>
      <Dot cx={132} cy={58} r={15} fill="paper" />
      <Ink d="M132 44.6v3M132 68.4v3M118.6 58h3M142.4 58h3" strokeWidth={1.4} />
      <g className="qs-needle">
        <Ink d="M132 46.5L135.2 58L132 69.5L128.8 58Z" fill="paper" />
        <Ink d="M132 46.5L135.2 58H128.8Z" fill="deep" />
      </g>
      <Ink d="M8 89Q36 87.4 64 88.6" />
      <Ink d="M108 88.6Q130 87.6 152 89" />
    </>
  );
}

const SCENES = {
  harbor: { viewBox: '0 0 240 120', draw: Harbor },
  lighthouse: { viewBox: '0 0 240 160', draw: Lighthouse },
  changes: { viewBox: '0 0 160 96', draw: Changes },
  building: { viewBox: '0 0 160 96', draw: Building },
  components: { viewBox: '0 0 160 96', draw: Components },
  tokens: { viewBox: '0 0 160 96', draw: Tokens },
  settings: { viewBox: '0 0 160 96', draw: Settings },
} satisfies Record<string, { viewBox: string; draw: () => ReactNode }>;

export type QuietSceneName = keyof typeof SCENES;

/** The scenes of the Studio page headers, one per section (StudioHeader.astro, StudioHead.tsx). Quality has none in its
 * header: its lighthouse already sits in the verdict zone, next to the verdict. */
export const SECTION_SCENES = ['changes', 'building', 'components', 'tokens', 'settings'] as const satisfies readonly QuietSceneName[];
export type SectionSceneName = (typeof SECTION_SCENES)[number];

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
