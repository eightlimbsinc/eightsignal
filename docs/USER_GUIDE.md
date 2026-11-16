# EightSignal — User Guide

**Know what changes. Understand what matters. Act before it becomes a problem.**

EightSignal is 8limbs' internal tool for keeping track of important changes at AI and tech
providers (Cloudflare, OpenAI, Anthropic and others), understanding what they mean for our
clients, and turning them into tasks. It also monitors **Blend360's Cloudflare setup** to make
sure search engines and AI assistants can reach the site.

**Address:** https://eightsignal.netlify.app

> EightSignal only **reads** information. It never changes anything in Cloudflare, client
> websites, ClickUp or Slack. Every change stays a human decision.

---

## 1. Getting in

1. You'll receive an email invite ("You're invited to EightSignal"). Click **Accept the invite**. Check spam if it's not in your inbox. If an admin created your account instead, they'll send you a temporary password privately.
2. You land on the **Overview**, already signed in.
3. Go to **Settings → Your profile**:
   - type your name and click **Save**
   - set a password (12+ characters) and click **Set password**
4. Next time, go to the address above, choose the **Password** tab, and sign in. The **Email link** tab sends you a one-time sign-in link instead.

**"Access pending" screen?** An admin still has to approve your account. Ask them to set your role.

### Roles

| Role | Can do |
|---|---|
| **Viewer** | See everything except the security incident log; add bookmarks and notes |
| **Analyst** | Everything a viewer can, plus add intelligence, run Claude analyses and Cloudflare audits, manage tasks, clients and sources, and use the incident log |
| **Admin** | Everything, plus manage team roles, store Cloudflare tokens and delete clients |

Your role is shown at the bottom of the left sidebar, next to your email.

---

## 2. Finding your way around

The left sidebar has eight sections. Click **Collapse** at the bottom to make it narrower. On a
phone, use the ☰ menu at the top left.

| Section | What it's for |
|---|---|
| **Overview** | Your daily starting point: what's important and what needs attention |
| **Intelligence** | Every tracked announcement, with filters and search |
| **Cloudflare Monitor** | Blend360's Cloudflare security and AI-crawler accessibility. A red number means urgent findings. |
| **Impact Analysis** | All of Claude's assessments in one place, plus client-impact suggestions to confirm |
| **Action Center** | Tasks: who does what, by when |
| **Clients** | Each client's technology, relevant news, Cloudflare status and tasks |
| **Sources** | The official blogs and feeds EightSignal reads automatically |
| **Settings** | Your profile and password; for admins, the team, roles and activity log |

---

## 3. Your daily routine (5 minutes)

1. **Overview → Needs Attention.** Anything urgent: critical Cloudflare findings (Blend360 first), important news nobody has acted on yet, and overdue tasks. Click an item to open it.
2. **Overview → Signals That Matter.** The most important recent developments, ranked by impact and client relevance, **not** just by date.
3. **Action Center → tick "Assigned to me".** Your open tasks. Update their status as you work.
4. Once a week: **Cloudflare Monitor**. Check that Blend360's status hasn't changed and review new findings.

---

## 4. Intelligence: tracking what changes

### 4.1 Where records come from
- **Automatically:** every hour, EightSignal reads the official blogs and changelogs listed under **Sources**. New posts appear in **Intelligence**.
- **By you:** when you spot something important, add it yourself (4.2).

Duplicates are detected automatically. Adding the same article twice tells you it's "Already tracked" and links to the existing record.

### 4.2 Adding a record (Analyst / Admin)
1. **Intelligence → Add intelligence**.
2. **Submit a URL** (preferred): paste the address of the **announcement article**, for example a specific Cloudflare blog post. Choose the **Provider** and a **Category**, then click **Extract and save**.
3. If the site blocks automatic reading ("Could not fetch the URL"), use **Manual entry**: title, provider, category, original URL, publication date, summary and the pasted text.

Only add **news from providers**. Client websites belong in **Clients** and **Cloudflare Monitor**, not in Intelligence.

### 4.3 Reading a record
Each record shows the provider, category, publication and discovery dates, a link to the
**original source**, its status and the AI analysis. On the right:
- **Status:** new → reviewing → actioned → monitoring → archived / dismissed
- **Affected clients:** clients this news concerns, and why
- **Tasks** created from it
- **Internal notes** for the team

At the top: **Bookmark** to save it for later, and **Mark unread**. Opening a record marks it as read.

### 4.4 Deleting articles (Admin)
- **One article:** open it → **Danger zone** → **Delete this article…**
- **All unassessed articles:** at the top of **Intelligence**, open **Delete unassessed articles**, optionally pick a provider, type `DELETE`, and confirm.
- **A whole source and its articles:** **Sources** → **Delete…** on that source.

Deleted articles are remembered, so automatic collection won't bring them back (you can still add one manually). Tasks are kept.

### 4.5 Filtering the feed
Search by words in the title or summary, or filter by provider, category, impact, status, date
range, or **Unread / Bookmarked**. Click **Filter** to apply.

---

## 5. AI impact analysis (Claude)

Click **Analyse with Claude** on a record (Analyst / Admin). It takes up to about 30 seconds.
New records collected automatically are analysed in the background, newest first.

You get:

| Part | Meaning |
|---|---|
| **Impact level** | Critical · High · Medium · Low · Informational |
| **What happened / Why it matters** | Plain-language explanation |
| **Who is affected** | Teams and departments (Development, Technical SEO, Marketing, Operations, Security, Product, Leadership) |
| **Risk / Opportunity** | What could go wrong if we do nothing, and possible new services or advantages |
| **Recommended actions** | Concrete next steps. Click **Create task** on any of them. |
| **Source type** | Verified announcement, official documentation, or commentary / speculation / prediction. Treat the last three with care. |
| **Confidence** | How well-supported the analysis is, and why |

**Re-analyse** runs it again (for example after you add content); older versions are kept in
**Analysis history**.

Claude's analysis is a starting point, not a decision. Check the original source before acting
on anything important.

### Client impacts
Claude suggests affected clients based on their **recorded** technology (for example, "uses
Cloudflare"). Suggestions start as **suggested**. Confirm or reject them on the record, the
client page, or **Impact Analysis → Client impact suggestions**. Statuses: suggested →
confirmed / in review → not affected / resolved.

You can also link a client by hand: on a record, use **Associate a client**.

---

## 6. Action Center: getting things done

- **Create a task:** from a recommended action (**Create task**), from a Cloudflare finding (**Create task**), or at the bottom of **Action Center → New task**.
- **Fields:** title, description, priority (critical/high/medium/low), department, assignee, due date, client, related intelligence.
- **Statuses:** **Open → In Progress → In Review → Completed**, or **Dismissed** if it's not needed.
- **Filters:** status, priority, *Assigned to me*, *Include completed/dismissed*.
- Open a task to edit it, see its linked records, and add **comments**.
- **Overdue** tasks show the due date in red and appear in Needs Attention.

Tasks are **not** sent to ClickUp automatically.

---

## 7. Cloudflare Monitor (Blend360)

### 7.1 The dashboard
**Cloudflare Security & AI Readiness** shows each monitored website with:
- **Status:**

| Status | Meaning |
|---|---|
| **Healthy** | All checks ran in the last 7 days and nothing significant is open |
| **Needs Review** | Some checks didn't run, or medium findings are open |
| **Warning** | High-severity findings are open |
| **Critical** | Critical findings are open. Act now. |
| **Not Connected** | No Cloudflare connection yet, so checks are limited |

  EightSignal never says "Healthy" just because it can connect. Checks must actually have run.
- **Checks:** green = completed, grey = skipped or unavailable, yellow = needs a manual check.
- Open findings and the time of the last audit.

Click the **domain name** (for example blend360.com) to open its detail page.

### 7.2 Running an audit (Analyst / Admin)
On the website's page, click **Run full audit** (top right). It takes 20–40 seconds. Audits
also run **automatically every 6 hours**.

An audit checks:
- **Firewall (WAF) rules:** anything that could block search engines, AI assistants or real visitors
- **Redirect rules:** loops, chains, odd destinations, bot-only redirects
- **Bot settings** and recent **security events**
- **robots.txt:** which crawlers the site asks to stay away
- **Accessibility tests:** loading key pages as a normal browser and as each crawler

### 7.3 Reading the results
- **Last audit:** each check and whether it ran.
- **Findings:** problems sorted by severity, each with an explanation, a **recommendation** and **evidence**. For each one you can:
  - set a status: **acknowledged** (seen), **resolved**, **false positive** (not a real issue), or **accepted risk** (intentional)
  - click **Create task** to assign the fix to someone
- **AI crawler & agent access matrix:** for every crawler and AI agent, grouped into four types:
  - **Search crawlers** (Googlebot, OAI-SearchBot, Claude-SearchBot…): they bring visibility in search and AI search.
  - **User-directed fetching** (ChatGPT-User, Claude-User…): an AI fetching a page because a person asked about it.
  - **Browser & personal agents** (Claude-Agent…): AI agents browsing on a person's behalf.
  - **AI training crawlers** (GPTBot, ClaudeBot…): collect content for model training. Blocking these is often intentional.

  Columns: Cloudflare policy · robots.txt · observed access · last activity · conflicts and recommended action.
- **robots.txt analysis**, **WAF rules**, **Redirect rules**: what's currently configured.
- **Website accessibility tests:** status code, speed and redirects per page and per crawler.
- **Configuration change history:** what changed in Cloudflare and when. **Acknowledge** changes you've confirmed were intended.
- **Configuration snapshots:** **Compare with previous** shows exactly what changed.

### 7.4 Important to know
- **"Simulated" tests aren't the real crawler.** EightSignal sends requests *pretending* to be Googlebot and others from a cloud server. Cloudflare often (correctly) rejects these fakes. Real crawler blocking is confirmed by the firewall and security-event checks.
- **"Cloudflare challenged EightSignal's server-side check" (Medium):** open that page in your normal browser. If it loads, set the finding to **false positive**.
- **robots.txt ≠ firewall.** robots.txt *asks* crawlers to stay away; Cloudflare *enforces*. A crawler can be allowed in one and blocked in the other, and the matrix shows both.
- **Record what you verify by hand:** in the matrix, click **Record verified policy** for a crawler after checking Cloudflare's dashboard (for example the AI Crawl Control settings).

### 7.5 Monitored pages
At the bottom of the website page, add important pages (service, landing, blog) and tick
**Critical** for the most important ones. Critical pages are tested with every crawler in each audit.

### 7.6 Security incident log (Analyst / Admin)
**Cloudflare Monitor → Incident log.** Record anything suspicious: unauthorized configuration
changes, strange redirects, unusual admin activity, traffic anomalies, investigations. Fill in
type, severity, date, description, status (open → investigating → contained → resolved →
closed) and resolution notes. This log is restricted to analysts and admins.

---

## 8. Clients

- **Clients** lists every client with their technology, services, Cloudflare status, open impacts and open tasks.
- Open a client to see **relevant intelligence** (and why it matters to them), their Cloudflare websites and their tasks.
- **Register client** (Analyst / Admin): name, website, industry, CMS, hosting, CDN, technology stack and active services. **Record only what you know is true.** EightSignal uses these details to match news to clients and never guesses a client's setup.
- **Delete** (Admin only): on the client page, under **Danger zone**. Type the client's name to confirm. This removes the client's monitoring data permanently; tasks are kept.

---

## 9. Sources (Analyst / Admin)

**Sources** lists the official feeds EightSignal reads.
- **Add source:** name, provider, type (RSS, Atom, changelog page, announcement page), official URL and default category.
- New sources start **inactive**. Click **Run now** to test; if it says "Found X, created Y", click **Activate**.
- **Collection history** shows each run: found, new, duplicates, errors. Failing sources are retried less often automatically.
- **Analyse pending / failed:** analyses up to 2 waiting records per click, newest first.

---

## 10. Settings

- **Your profile:** your name and password.
- **Configuration status:** whether the system's connections are set up (values are never shown).
- **Admins only:**
  - **Team & roles:** change anyone's role
  - **Auto-approved email domains:** new 8limbs users get a role automatically
  - **Activity log:** who did what and when

---

## 11. Severity and status cheat sheet

| Severity | Meaning | Typical response |
|---|---|---|
| **Critical** | Likely outage, security exposure or loss of search visibility | Act today |
| **High** | Material impact on a client or service | Plan action this week |
| **Medium** | Relevant; worth scheduling or verifying | Review and decide |
| **Low** | Minor | Note it |
| **Info / Informational** | Awareness only | No action needed |

| Finding status | Use when |
|---|---|
| Open | New, not yet reviewed |
| Acknowledged | Seen and being handled (set automatically when you create a task) |
| Resolved | Fixed (also set automatically when an audit no longer detects it) |
| False positive | Not a real problem |
| Accepted risk | Intentional, for example blocking AI training crawlers on purpose |

---

## 12. Do's and don'ts

**Do**
- Check the **original source** before acting on an analysis.
- Create **tasks** for anything that needs doing, with an owner and a due date.
- Mark findings **false positive / accepted risk** when appropriate, so real problems stand out.
- Record suspicious Cloudflare activity in the **incident log**.

**Don't**
- Don't paste passwords, API keys or tokens into notes, comments, tasks or chat.
- Don't make Cloudflare changes because EightSignal said so. Agree on them first, then apply them manually in Cloudflare.
- Don't add client websites as "intelligence".

---

## 13. FAQ

**The Overview is empty.** Records appear once sources are active and Claude has analysed them.
You can analyse a few by hand (**Sources → Analyse pending / failed**, or **Analyse with
Claude** on a record).

**A page shows "EightSignal hit a server error" with a Reference code.** Send the code to an admin.

**I can't see the "Run full audit" or "Create task" buttons.** You have the **Viewer** role.
Ask an admin for **Analyst**.

**Blend360 shows "Not Connected".** The Cloudflare connection token is missing or invalid. Ask an admin.

**Who do I contact?** Your EightSignal admin (see **Settings → Team & roles**).
