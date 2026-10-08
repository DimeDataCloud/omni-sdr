# omni-sdr-journal

The grounding record for the Omni-SDR project, and for this project only. Both agents (Claude and Gemini) read it
before claiming facts, and write to it as they work. Christian asked for it on 2026-09-28.

- **Local path:** `C:\Users\cdsec\Halo\projects\omni-sdr-journal` (Drive-synced; git data lives in `~/.halo-git/omni-sdr-journal`)
- **Code and specs:** `DimeDataCloud/omni-sdr` at `projects/omni-sdr`. The rules both agents follow: `AGENT-RAILS.md` there.

## What goes where

| Folder | Holds | Rule |
|---|---|---|
| `journal/YYYY-MM-DD.md` | What happened that day: who did what, with evidence (commit, command output, URL) | Append only. Past entries are never edited; corrections are new entries that say what they correct. |
| `citations/<topic>.md` | Grounding for every external fact the build depends on (limits, prices, scopes, API behaviour, law) | One file per topic. Every claim carries a source. A claim without a source isn't a citation. |
| `citations/INDEX.md` | Every `[VERIFY]` item from `docs/claude/SPEC.md` §15 and its status | Update the status when a citation lands. |

## What does NOT go here
- **Decisions.** Christian's decisions live only in `omni-sdr/docs/claude/DECISIONS.md`. The journal may say "decided X, see DECISIONS" but never restates the decision as its own record.
- **Secrets or personal data.** No keys, tokens, prospect/customer/signup data, and no screenshots containing them.
- **The spec.** Link to `SPEC.md` sections; don't copy them.

## Journal entry format
```markdown
### HH:MM · <claude|gemini|christian> · <short title>
What: <one or two lines>
Evidence: <commit sha / command + result line / URL>
Status: done | partial | UNVERIFIED
```

## Citation format (`citations/<topic>.md`)
```markdown
## <the claim, stated exactly as the build relies on it>
- Source: <URL>  (official docs first; a blog or forum only when nothing official exists, and say so)
- Retrieved: YYYY-MM-DD by <claude|gemini>
- Excerpt: "<the sentence(s) that support the claim, quoted>"
- Used in: <SPEC §n / station NN / file>
- Confidence: confirmed | partial | contradicted (say what contradicts it)
```
A fact that changes (prices, quotas) gets a new dated block under the same claim; the old block stays.

## Using it for grounding
Before stating a platform fact in a spec, code comment or report, look for it in `citations/`. If it's there, cite the file.
If it isn't, mark it `[VERIFY]` and either research it (then add the citation) or leave it listed as open in `citations/INDEX.md`.
