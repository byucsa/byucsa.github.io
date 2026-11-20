// Sample content shown only in demo mode (no Supabase configured).
// In live mode this comes from the `resources` and `scout_roles` tables.
export const DEMO_RESOURCES = [
  { section: "Case practice", title: "Casing Preparation Agent", description: "Strategy application prep, case-interview drills, and 19 full cases with an AI interviewer and scorecards.", url: "https://claude.ai/artifact/V6MPwjmsgZ2AuoUGFXAxhs", status: "live", sort: 5 },
  { section: "Recruiting prep", title: "Strategy resume template", description: "One page, written for strategy recruiters, with annotated examples.", url: null, status: "building", sort: 10 },
  { section: "Recruiting prep", title: "Strategy case interview guide", description: "Frameworks, practice cases, and how in-house cases differ from consulting ones.", url: null, status: "building", sort: 20 },
  { section: "Recruiting prep", title: "Behavioral question bank", description: "Common questions with sample answers from members who got offers.", url: null, status: "building", sort: 30 },
  { section: "Recruiting prep", title: "Outreach templates", description: "Email and LinkedIn messages for cold outreach, follow-ups, and thank-you notes.", url: null, status: "building", sort: 40 },
  { section: "Skills library", title: "Market sizing practice set", description: "Worked problems with model answers, easiest to hardest.", url: null, status: "building", sort: 50 },
  { section: "Skills library", title: "Excel modeling templates", description: "Market entry, pricing, and build-vs-buy models from our workshops.", url: null, status: "building", sort: 60 },
  { section: "Skills library", title: "Executive slide templates", description: "Recommendation decks with the answer first, CSA-branded.", url: null, status: "building", sort: 70 },
  { section: "Events and network", title: "Speaker slides", description: "Posted when speakers allow it, with notes from each session.", url: null, status: "after each event", sort: 80 },
  { section: "Events and network", title: "Utah strategy team directory", description: "Which local companies have strategy and corp dev teams, and who to contact.", url: null, status: "building", sort: 90 },
  { section: "Events and network", title: "Member placement directory", description: "Where members have interned, and who is open to a 15-minute call.", url: null, status: "building", sort: 100 },
];

// Placeholder rows only. Real postings sync nightly from the Internship Scout sheet.
export const DEMO_SCOUT = [
  { posting_id: "demo-1", company: "[Company A]", title: "Corporate Strategy Intern", location: "Salt Lake City, UT", work_arrangement: "On-site", deadline: "Jan 15", deadline_date: "2027-01-15", compensation: "[Pay]", responsibilities: "Market sizing and growth initiatives for the strategy team.", apply_url: null, eligibility: "Graduating 2028", synced_at: null },
  { posting_id: "demo-2", company: "[Company B]", title: "Pricing Analyst Intern", location: "Lehi, UT", work_arrangement: "Hybrid", deadline: "Jan 22", deadline_date: "2027-01-22", compensation: "[Pay]", responsibilities: "Pricing analysis and deal desk support.", apply_url: null, eligibility: "Juniors", synced_at: null },
  { posting_id: "demo-3", company: "[Company C]", title: "Corporate Development Intern", location: "Chicago, IL", work_arrangement: "On-site", deadline: "Feb 3", deadline_date: "2027-02-03", compensation: "[Pay]", responsibilities: "Acquisition screening and diligence support.", apply_url: null, eligibility: "Graduating 2028", synced_at: null },
  { posting_id: "demo-4", company: "[Company D]", title: "Strategy & Operations Intern", location: "Remote (US)", work_arrangement: "Remote", deadline: "Feb 10", deadline_date: "2027-02-10", compensation: "[Pay]", responsibilities: "Planning cadence and KPI reviews with the COO's team.", apply_url: null, eligibility: "Any major", synced_at: null },
  { posting_id: "demo-5", company: "[Company E]", title: "FP&A Intern", location: "Draper, UT", work_arrangement: "On-site", deadline: "Rolling", deadline_date: null, compensation: "[Pay]", responsibilities: "Forecasting and leadership reporting.", apply_url: null, eligibility: "Juniors", synced_at: null },
];
