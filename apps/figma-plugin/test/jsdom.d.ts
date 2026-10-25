// jsdom ships no types and @types/jsdom is not installed: the flow tests use only JSDOM's window.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; pretendToBeVisual?: boolean });
    readonly window: Window;
  }
}
