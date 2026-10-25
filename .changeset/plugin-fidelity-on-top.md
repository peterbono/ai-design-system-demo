---
'@bridge-ds/figma-plugin': patch
---

Check fidelity leads the screen. While it runs, its progress row sits right under the headline ("Comparing with the code") and "Check again" is hidden. Once it is done, the headline is its result ("1 component differs from the code", "Figma matches the code", "Can't compare yet") instead of "Up to date", and the comparison sits above the component lists. A set that differs without a known cause reads "Looks different from the code in 2 of 6 variants." instead of pixel figures. After a first pull that built components, "Check fidelity" is the primary action. The stray mark next to "Getting the request ready" is gone.
