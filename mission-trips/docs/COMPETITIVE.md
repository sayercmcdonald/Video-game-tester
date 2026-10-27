# Competitive Landscape

_Researched 2026-10-27 via web search. Most competitor information comes from **vendors' own marketing and help pages**; treat it as claims, not verified fact. Where a source is a competitor describing another product, that's noted. Absence of a feature in search results is **not** evidence that a product lacks it._

## Direct competitors (mission-trip management)

| Product | What they say it does | Pricing found | Source quality |
| --- | --- | --- | --- |
| **ManagedMissions** (nonprofit) | Applications with custom questions, team email/text, public participant fundraising profiles, multi-trip dashboard with access levels, trip cloning, grouping by region/ministry; **budgeting and expense tracking**; donor management; year-end statements; Stripe / PushPay / Vanco; **Planning Center integration** (donation export). Says it never holds funds and takes no transaction fee. | Online fundraising on "Premium" plan; amounts not found | Vendor site, Planning Center integration page |
| **Go Method** (ACS Technologies) | Trip details, applicant tracking, **background checks**, documents, fundraising, travel insurance, flights; also retreats/camps; integrates with ChMS (incl. Planning Center), payment processors (Pushpay and others), e-signature tools; works stand-alone. | Active trips from **$20/month**, +$10 per additional 10 participants; free trial | Vendor pages and help center |
| **Focus Missions** (52projects) | Consent forms, documents, donations, signatures, team communication, trip database; integrates with ChMS for giving statements. Partnered with **Tithely** and **Pushpay**; Ministry Platform partner. | Not found | Partner pages (Tithely, Pushpay, MinistryPlatform), one forum anecdote |
| **ServiceReef** | Master + trip applications, trip pages, cloning, personal donation pages, weekly donation reports, manual payment bulk upload, donor-name visibility controls, a **budgeting tool** (Essentials tier). | **$85 / $130 / $175 per month** (10 / 15 / 20 active trips); no platform fee on donations | Vendor pricing page (search result) |
| **GO** (MKDSCPLS) | Budget tracking; free tier. | Free up to 5 trips; $9/mo Starter; $39/mo unlimited | Comparison site + vendor |
| **MissionDesk**, **Gratona Trips**, **HelpYouSponsor** | Budget modules (estimated vs. actual), registration + fundraising + budgets, trip management. | Not checked | Vendor pages |

## Broad church platforms

| Product | Relevance |
| --- | --- |
| **Subsplash** | Giving (web, app, text, recurring, guest), campaigns/funds/pledges, donor fee coverage, event registration. We found **no independent source** describing dedicated mission-trip features; one competitor (HelpYouSponsor) claims it lacks individual trip-fundraising pages and a bundled trip workflow — a competitor's framing. API access appears to be provisioned on certain plans, not self-serve (third-party source). |
| **Tithely** | Giving platform; integrates with Breeze, Planning Center, Rock, Ministry Platform and others. For trips it **partners with Focus Missions** rather than building its own (per Tithely's help center). No public self-serve developer API found. |
| **Planning Center** | Widely used ChMS with Giving and Registrations. **Public, documented REST API**, Giving writable. ManagedMissions and Go Method both integrate with it. |

## What this means for Sent

1. **Feature parity is table stakes, not differentiation.** Applications, participant fundraising pages, documents/e-sign, team messaging, and even **budgeting/expense tracking** are already offered by several competitors. "All-in-one" is not unique.
2. **Price expectations are low.** $0–$175/month for small-to-mid churches. Go Method starts at $20/month per active trip. Sent cannot charge a premium without a clearly better outcome.
3. **Integration with the church's existing system matters.** Competitors highlight Planning Center and ChMS integrations; a church will not re-enter gifts in two places. Sent's CSV exports help now; a Planning Center Giving sync is the most credible first live integration.
4. **Plausible differentiators to test (not yet proven):**
   - *Financial integrity you can show a finance committee:* an append-only ledger, gifts counted only when settled, pledges kept apart, fees and refunds explicit, two-person approval on spending, export-ready records. Competitors mention budgets; we found no evidence either way about ledger-level controls.
   - *Donor-facing transparency:* live (opt-in) and published reports of how pooled trip funds were used. We did not find this advertised by competitors, which is **not** proof they lack it.
   - *Proactive readiness:* explainable alerts (behind-pace fundraising, overdue items, budget overruns, shortfalls). Go Method advertises automated reminders.
   - *Mobile-first experience* for participants and donors.
5. **Gaps vs. competitors today:** background checks (Go Method), SMS (ManagedMissions), trip cloning (several), e-signature service integration, travel insurance/flights (Go Method), Planning Center sync (ManagedMissions, Go Method), multi-region grouping.

## Sources

- ManagedMissions: [managedmissions.com](https://www.managedmissions.com), [FAQ](https://www.managedmissions.com/faq.html), [Planning Center integration](https://planningcenter.com/integrations/managedmissions)
- Go Method: [ACS Technologies product page](https://www.acstechnologies.com/go-method/?p=234), [pricing](https://www.acstechnologies.com/go-method/?p=190), [help guides](https://help.acst.com/en/go-method/guides), [case study](https://www.acstechnologies.com/church-growth/?p=20792)
- Focus Missions: [Tithely help article](https://help.tithe.ly/hc/en-us/articles/29370472793111-Tithely-and-Focus-Missions-A-Powerful-Partnership-for-Mission-Trip-Management), [Tithely blog](https://get.tithe.ly/blog/focus-missions), [MinistryPlatform webinar](https://kb.ministryplatform.com/kb/webinars/automated-trip-management-with-focus-missions), [SoftwareReviews listing](https://www.softwarereviews.com/products/52projects-focus-missions), [Pushpay partner page](https://grow.pushpay.com/lp-demo-partner-focus-missions.html), [Brigada forum](https://brigada.org/?p=28089)
- ServiceReef: [pricing](https://www.servicereef.com/pricing), [compare](https://www.servicereef.com/compare)
- Others: [MissionTripPlanning comparison](https://missiontripplanning.com/compare), [GO (MKDSCPLS)](https://go.mkdscpls.com/), [MissionDesk](https://www.missiondesk.cloud/), [HelpYouSponsor vs Subsplash](https://helpyousponsor.com/compare/subsplash)
- Subsplash: [GetApp listing](https://www.getapp.co.uk/software/114743/subsplash), [apis.io pricing profile](https://apis.io/plans/subsplash/subsplash-plans-pricing/), [Rock plugin setup](https://intercom.help/subsplash/en/articles/8615077-rock-plugin-setup)
- Tithely: [Breeze integration](https://help.tithe.ly/hc/en-us/articles/6762475781783), [Integrations section](https://help.tithe.ly/hc/en-us/sections/6648739886487-Integrations), [engineering blog](https://engineering.tithe.ly/api/api-specification/software/2024/06/11/an-api-a-developer-can-love)
- Planning Center API: [developers](https://planningcenter.com/developers), [help](https://help.planningcenter.com/en/the-planning-center-api.html), [Giving API writable](https://www.planningcenter.com/blog/2017/09/payment-sources)
