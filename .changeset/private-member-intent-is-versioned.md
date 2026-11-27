---
"@systemfsoftware/changesets-adapter": patch
---

A private workspace member a change intent names is versioned again, so a surface bound to it (a cargo crate bound to a private member) moves with it. A private member no intent names stays out of the plan, so it is still never versioned or given a CHANGELOG entry.
