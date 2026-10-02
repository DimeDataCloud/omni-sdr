# Workspace: fewer pages, full control (PROPOSAL, built on demo data)

Status: **proposal** (Rails §3.9). Christian set the direction (DECISIONS 2026-10-01, "A simpler workspace"); the grouping and names below are Claude's proposal until he confirms them.
Built 2026-10-01 in the cloud session on `claude/amazing-maxwell-876zb2`.

## 1. Six sections instead of ten pages

| Section | Pages (tabs under the top bar) | What it answers |
|---|---|---|
| **Home** | Home | What needs me today? |
| **Outbound** | Approvals, Leads | Who are we reaching, and what's waiting for my yes? |
| **Inbound** | Inbox, Meetings | Who answered, and what did it turn into? |
| **Marketing** | Studio | What are we putting out? |
| **Results** | Analytics | What worked? |
| **Setup** | Agents, Data, Connections, Settings | How does every agent, dataset, tool and rule behave? |

- **Top bar:** sections only. A section link returns to the page last used in it, stored per viewer.
- **Tabs:** under the top bar, a section's pages show as tabs, with their counts (drafts in review, replies due).
- **URLs** stay one page each (`/w/:ws/approvals`), so links, bookmarks and shortcuts keep working.
- **Phone:** the bar shows Home, Outbound, Inbound and Marketing, plus More. More lists Results and Setup, grouped by section.
- **Client viewers** see only the sections they have pages in (Results, Inbound's Meetings, and Outbound's Approvals when client approvals are on).

## 2. Setup is the control panel

Each thing that acts or is acted on has one place to see its decisions, correct them, tune it and set it up.

| Thing | Where | What's there |
|---|---|---|
| **Agent** | Setup → Agents, open one | **Role** (prompt, model tier). **Autonomy**: Suggest and Draft for approval are open; Send within guardrails and Autopilot are locked, with the reason. **Data** (what it reads). **Guardrails** (the shared floor, read-only). **Performance** (30-day drafted, approved, rejected, edited, blocked, approval rate, and the corrections people made, each linked to its draft). |
| **Dataset** | Setup → Data | Every dataset with size, freshness, the rules it carries and which agents read it. Access is set per dataset, or for everything at once in the agent × dataset matrix. The do-not-contact list is always on. "Open" goes to the page where its rows are corrected. |
| **Tool** | Setup → Connections | Unchanged: each connector, its scopes with a reason for each, and who pays. |
| **Feature and rules** | Setup → Settings | Unchanged: workspace switches (client approvals, Auto-adjust), sending and safety (caps, holds, do-not-contact), members, activity. |
| **Routine** | Setup → Agents → Routines | Unchanged. |

## 3. Proposed API (demo adapter answers all three)

- `Agent.autonomy` (`suggest | draft | guardrails | autopilot`) on `GET/PATCH …/agents`. A `PATCH` above `draft` returns `403` until Trust Level 2 exists (SPEC §5 floor: a person approves every message).
- `GET …/agents/{id}/stats?days=30` (`reports_view`): drafted, approved, rejected, blocked, in review, edited first, approval rate, and up to 12 corrections.
- `GET …/datasets` (`reports_view`): `{ key, name, about, source, count, updatedAt, readers[], rules[], manage, always }`. Access is the agent's `contextSources` (tags), changed through `PATCH agents`.

## 4. Open

1. Confirm the six names and the grouping, or rename them. Alternatives: "Today" for Home; "Pipeline" for Outbound.
2. Whether Leads should hold campaigns as their own tab, or move them into Outbound as a third page.
3. Auto-adjust's learned changes (SPEC Station 08) belong in each agent's Performance tab once the backend exists.
