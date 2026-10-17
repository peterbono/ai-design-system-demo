// Types of ramps.js, the ramp engine shared by packages/tokens/scripts/ramps.mjs and @bridge-ds/core.

export type Step = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
/** sRGB, each component 0..1. */
export type Rgb = number[];
export type Ramp = Record<Step, Rgb>;
export type StepCurve = (step: Step) => number;

export declare const STEPS: Step[];
export declare const LIGHTNESS: Record<Step, number>;
export declare const BELL: Record<Step, number>;
export declare const PIN_TOLERANCE: number;
export declare const NEUTRAL_ANCHORS: Record<200 | 600 | 900, string>;
export declare function neutralOffset(): StepCurve;

export declare function bellChroma(peak: number): StepCurve;
export declare function neutralChroma(scale?: number, low?: number, base?: number, slope?: number): StepCurve;
export declare function oklchToLinear(L: number, C: number, h: number): Rgb;
export declare function oklch(L: number, C: number, h: number): Rgb;
export declare function toOklch(rgb: Rgb): { L: number; C: number; h: number };
export declare function isHex(s: unknown): s is string;
export declare function fromHex(hex: string): Rgb;
export declare function round3(x: number): number;
export declare function toHex(rgb: Rgb): string;
export declare function dtcgColor(rgb: Rgb, alpha?: number): { colorSpace: 'srgb'; components: number[]; hex: string; alpha?: number };
export declare function generateRamp(opts: { hue: number; chroma: StepCurve; offset?: StepCurve; pins?: Partial<Record<Step, string>> }): Ramp;
export declare function nearestStep(rgb: Rgb): Step;
export declare function anchoredRamp(hex: string, pinStep?: Step): { hue: number; peak: number; step: Step; distance: number; ramp: Ramp };
export declare function tintedNeutral(hex: string): { hue: number; scale: number; ramp: Ramp };
