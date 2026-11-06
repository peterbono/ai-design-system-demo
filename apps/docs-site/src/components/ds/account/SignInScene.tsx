// The sign-in zone's scene (board A, "The bridge closes", 2026-11-06): what Bridge does, told by a harbor. A bridge with
// a piece missing; a sailboat passes with a piece that does not fit and the hook leaves it; a barge brings the one that
// fits, the hook lays it in, the flag rises, it reads "kept" and a cart crosses. Motion and colors: styles/sign-in-scene.css.
// Decorative: the zone's words say the same. Reduced motion: the bridge closed, nothing moves.
import '../../../styles/sign-in-scene.css';

const wave = (x: number, y: number, n: number) => `M${x} ${y}` + 'q20 -5 40 0t40 0'.repeat(n);

export function SignInScene() {
  return (
    <svg className="ss" fill="none" stroke="currentColor" viewBox="0 250 760 594" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <g className="ss-cloud">
        <path data-paper d="M560 322Q552 306 571 303Q576 286 597 291Q610 278 626 291Q646 288 646 308Q656 322 637 322Z" />
      </g>
      <g className="ss-gulls">
        <path className="ss-flap" d="M40 330q8 -8 16 0q8 -8 16 0" strokeWidth="2" />
        <path className="ss-flap ss-flap-late" d="M92 348q6 -6 12 0q6 -6 12 0" strokeWidth="2" />
      </g>

      <path d="M80 470Q380 190 680 470" />
      <path d="M140 419.6V470M200 380.4V470M260 352.4V470M320 335.6V470M440 335.6V470M500 352.4V470M560 380.4V470M620 419.6V470" strokeWidth="1.8" />

      <g className="ss-flag">
        <path d="M380 330V276" strokeWidth="2" />
        <path data-deep d="M380 276Q398 275 416 284Q398 293 380 296Z" />
      </g>
      <path className="ss-rope" d="M380 330V602" strokeWidth="1.8" />
      <path className="ss-hook" d="M372 350h16M380 342v8" />

      <path data-paper d="M-1200 470H320V486H-1200Z" />
      <path data-paper d="M440 470H2000V486H440Z" />
      <path data-paper d="M68 462L92 461L94 662L66 663Z" />
      <path data-paper d="M668 462L692 461L694 662L666 663Z" />

      <g className="ss-cart">
        <path data-paper d="M0 446H34V464H0Z" />
        <circle data-ink cx="7" cy="467" r="3" strokeWidth="1.4" />
        <circle data-ink cx="27" cy="467" r="3" strokeWidth="1.4" />
      </g>

      <g className="ss-kept">
        <path d="M380 492V516" strokeWidth="1.6" />
        <text x="380" y="542" textAnchor="middle">
          kept
        </text>
      </g>

      <path className="ss-wave" d={`M-1200 640${'q20 -6 40 0t40 0'.repeat(45)}`} strokeWidth="2.2" />

      <g className="ss-boat-a">
        <g transform="translate(0 618)">
          <g className="ss-bob">
            <path data-paper d="M-54 0H54L42 20H-42Z" />
            <path d="M-6 0V-82" />
            <path data-paper d="M-6 -78L-6 -8L40 -8Z" />
            <path data-paper d="M-6 -66L-6 -8L-38 -8Z" />
            <circle data-paper cx="-41" cy="-14" r="7" />
          </g>
        </g>
      </g>
      <g className="ss-boat-b">
        <g transform="translate(0 618)">
          <g className="ss-bob ss-bob-late">
            <path data-paper d="M-92 0H92L78 20H-78Z" />
            <circle data-paper cx="-74" cy="-20" r="6" />
            <path d="M-74 -14V0" />
            <path d="M-74 -10L-62 -22" strokeWidth="2" />
          </g>
        </g>
      </g>
      <g className="ss-block-x">
        <g className="ss-block-y">
          <path data-deep d="M-60 602H60V618H-60Z" />
        </g>
      </g>

      <path className="ss-wave ss-wave-2" d={[wave(-1160, 700, 2), wave(-760, 700, 3), wave(-360, 700, 2), wave(120, 700, 3), wave(560, 700, 3), wave(1000, 700, 2), wave(1400, 700, 3)].join('')} strokeWidth="2" />
      <path className="ss-wave ss-wave-3" d={[wave(-1000, 760, 3), wave(-520, 760, 2), wave(40, 760, 3), wave(480, 760, 3), wave(900, 760, 2), wave(1300, 760, 3)].join('')} strokeWidth="2" />
      <path className="ss-wave" d={[wave(-900, 815, 2), wave(-440, 815, 3), wave(200, 815, 3), wave(640, 815, 3), wave(1120, 815, 2)].join('')} strokeWidth="2" />
    </svg>
  );
}
