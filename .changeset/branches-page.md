---
'@bridge-ds/docs-site': minor
---

Studio Branches is all the work: the summary banner, the tabs and the status menu are gone. The header holds "History" (now a link, same view at ?view=history) and "Create branch" (the Home menu). One segmented control picks Mine, Waiting on me or All; rows are the Home row (before/after, who, title, Jira key, status pill, "N updates on main · Update from main" when behind), grouped by product (Admin demo, Library); explorations are rows with an Exploration status; merged and closed branches sit behind "N merged this month. Show merged". Token branches carry a checkbox to preview up to 4 together from a floating bar: one checked offers "Try it alone", two to four "Preview together" (a dialog asks for picks when they set a token differently). Old ?status=, ?tier=, ?view= and ?pr= links keep working. Also fixes the History token filter, whose field lost its id inside the DS Field.
