// Types of fix-engine.gen.js, the bundle of @bridge-ds/core that api/claude runs (scripts/build-fix-engine.mjs): the
// same names, typed from core's sources. Keep the list in step with ENGINE_EXPORTS (fix-engine-fresh.test.ts checks).
export {
  anthropicReplyText,
  anthropicRequest,
  DEFAULT_FIDELITY_RUN_FILE,
  DEFAULT_FIGMA_FIXES_FILE,
  DEFAULT_GOVERNANCE,
  DEFAULT_MEASURED_SPECS_FILE,
  FIX_LOOP_MAX_ROUNDS,
  FIX_LOOP_MODEL,
  figmaFixesProposal,
  fixLoopOutcome,
  fixLoopRound,
  gapCaseFor,
  GitHubClient,
  loadConfig,
  parseFidelityRun,
  parseFigmaFixes,
  parseMeasuredSpecsFile,
  REQUESTS_BRANCH,
  startFixLoop,
} from '@bridge-ds/core';
export type { BridgeConfig, FigmaFidelityRun, FigmaFixesFile, FixLoopState, GapCase, GapCaseForInput, MeasuredSpecsFile } from '@bridge-ds/core';
