// Studio features that are built but switched off, in one place. The page (Astro, at build) and its scripts (in the
// browser) read the same constant, so a switch is one edit.

/**
 * Request triage (decide, assign, decline component change requests) in Studio. Off: teams triage in Jira (the Jira
 * sync mirrors each request there), so the Branches page shows no Requests tab and ?view=requests opens All branches.
 * The code stays: a request still opens by its link (?request=N), and "Ask for a component change" still creates one.
 */
export const REQUEST_TRIAGE_IN_STUDIO = false;

/**
 * Jira in Bridge: "Link a Jira ticket" when a change starts, the ticket key on rows, reviews and build requests, and
 * the Settings Integrations card that mirrors requests to Jira. Off for the MVP, so no screen, prompt or title says
 * Jira. The code stays (the key rules in @bridge-ds/core, the bridge-jira sync, the integrations form): one edit turns
 * it back on.
 */
export const JIRA_IN_BRIDGE = false;
