/**
 * Sample dataset for "explore with sample data": a believable founder-led
 * pipeline - companies, contacts, deals across every stage, meeting history,
 * and follow-ups - shaped exactly like an export so store.importAll()
 * installs it and wipes it through the normal, already-hardened path.
 *
 * Dates are generated relative to today so the board, follow-ups, and
 * forecast always look alive no matter when the sample is loaded.
 */

import { uid, todayISO, addDays } from './util.js';

export function sampleDataset(store) {
  const now = Date.now();
  const today = todayISO();
  const day = 86400000;
  const ago = (d) => now - d * day;

  const co = {
    northwind: uid(), lumen: uid(), atlas: uid(),
    ferrous: uid(), quill: uid(), harbor: uid(),
  };
  const companies = [
    { id: co.northwind, name: 'Northwind Robotics', industry: 'Manufacturing', website: 'northwindrobotics.example', size: '200-500', notes: 'Pilot went well; procurement is the long pole.', createdAt: ago(85) },
    { id: co.lumen, name: 'Lumen Health', industry: 'Healthcare', website: 'lumenhealth.example', size: '50-200', notes: 'Compliance review required before any rollout.', createdAt: ago(70) },
    { id: co.atlas, name: 'Atlas Freight', industry: 'Logistics', website: 'atlasfreight.example', size: '500+', notes: '', createdAt: ago(60) },
    { id: co.ferrous, name: 'Ferrous & Co', industry: 'Finance', website: 'ferrous.example', size: '10-50', notes: 'Referred by Dana at Atlas.', createdAt: ago(38) },
    { id: co.quill, name: 'Quill Analytics', industry: 'Software', website: 'quillanalytics.example', size: '10-50', notes: '', createdAt: ago(24) },
    { id: co.harbor, name: 'Harbor Supply', industry: 'Retail', website: 'harborsupply.example', size: '50-200', notes: 'Seasonal budget cycle - decisions land in Q4.', createdAt: ago(12) },
  ];

  const ct = {
    mei: uid(), tomas: uid(), dana: uid(), priya: uid(),
    jordan: uid(), sam: uid(), alex: uid(), noor: uid(), lena: uid(),
  };
  const contacts = [
    { id: ct.mei, name: 'Mei Tanaka', title: 'VP Operations', email: 'mei@northwindrobotics.example', phone: '+1 555 0142', companyId: co.northwind, source: 'Conference', status: 'active', tags: ['decision-maker'], notes: 'Decision maker. Prefers short calls over email.', createdAt: ago(85) },
    { id: ct.tomas, name: 'Tomas Ruiz', title: 'Plant Manager', email: 'tomas@northwindrobotics.example', phone: '+1 555 0178', companyId: co.northwind, source: 'Referral', status: 'active', tags: ['champion'], notes: 'Champion on the floor; loops in Mei.', createdAt: ago(80) },
    { id: ct.dana, name: 'Dana Whitfield', title: 'Head of Procurement', email: 'dana@atlasfreight.example', phone: '+1 555 0117', companyId: co.atlas, source: 'Cold outreach', status: 'customer', tags: ['champion', 'expansion'], notes: 'Signed the fleet pilot. Renewal conversation in Q1.', createdAt: ago(60) },
    { id: ct.priya, name: 'Priya Raman', title: 'CTO', email: 'priya@lumenhealth.example', phone: '+1 555 0163', companyId: co.lumen, source: 'Website', status: 'active', notes: 'Technical gatekeeper; wants a security review first.', createdAt: ago(70) },
    { id: ct.jordan, name: 'Jordan Blake', title: 'CFO', email: 'jordan@ferrous.example', phone: '+1 555 0186', companyId: co.ferrous, source: 'Referral', status: 'active', notes: '', createdAt: ago(38) },
    { id: ct.sam, name: 'Sam Okafor', title: 'Founder', email: 'sam@quillanalytics.example', phone: '+1 555 0129', companyId: co.quill, source: 'Social', status: 'lead', notes: 'Replied to launch thread; curious about pricing.', createdAt: ago(24) },
    { id: ct.alex, name: 'Alex Moreau', title: 'Ops Lead', email: 'alex@harborsupply.example', phone: '+1 555 0195', companyId: co.harbor, source: 'Inbound', status: 'lead', notes: 'Filled the demo form. No call yet.', createdAt: ago(12) },
    { id: ct.noor, name: 'Noor Haddad', title: 'Director of IT', email: 'noor@lumenhealth.example', phone: '+1 555 0151', companyId: co.lumen, source: 'Website', status: 'active', notes: 'Owns the security checklist.', createdAt: ago(55) },
    { id: ct.lena, name: 'Lena Fischer', title: 'COO', email: 'lena.fischer@example.com', phone: '+1 555 0109', companyId: null, source: 'Conference', status: 'lead', tags: ['met-at-conference'], notes: 'Met at SaaS Summit. Company TBD after their merger.', createdAt: ago(6) },
  ];

  // Deals across every stage: two closed months back (one won, one lost),
  // one won this month, and open deals spread over the coming months.
  // Each carries the journey that got it there, so time-in-stage, the
  // stalled markers, and per-stage velocity all have something to show.
  // Two of them are subscriptions - one won, one in play - so recurring
  // revenue, the MRR tile, and the spread forecast are visible too. Two
  // carry a buying committee, so roles and the missing-decision-maker
  // nudge have something to show as well.
  const hist = (...pairs) => pairs.map(([stage, d]) => ({ stage, at: ago(d) }));
  const deals = [
    { id: uid(), name: 'Atlas Freight - fleet pilot', value: 3000, billing: 'monthly', term: 6, stage: 'won', contactId: ct.dana, companyId: co.atlas, expectedClose: addDays(today, -40), notes: 'Signed 6-month pilot.', closeReason: 'Product fit', closeReasonNote: 'Fuel-savings numbers from the trial did the selling.', createdAt: ago(58), updatedAt: ago(40), closedAt: ago(40), stageHistory: hist(['new', 58], ['qualified', 53], ['proposal', 48], ['negotiation', 44], ['won', 40]) },
    { id: uid(), name: 'Quill Analytics - starter plan', value: 4800, stage: 'lost', contactId: ct.sam, companyId: co.quill, expectedClose: addDays(today, -25), notes: 'Went with in-house build; revisit in 6 months.', closeReason: 'No budget', closeReasonNote: 'Engineering time was free to them; ours was not.', createdAt: ago(24), updatedAt: ago(20), closedAt: ago(20), stageHistory: hist(['new', 24], ['qualified', 22], ['lost', 20]) },
    { id: uid(), name: 'Ferrous & Co - reporting add-on', value: 7500, stage: 'won', contactId: ct.jordan, companyId: co.ferrous, expectedClose: addDays(today, -2), notes: '', closeReason: 'Referral strength', closeReasonNote: 'Dana at Atlas vouched for us unprompted.', createdAt: ago(30), updatedAt: ago(2), closedAt: ago(2), stageHistory: hist(['new', 30], ['qualified', 26], ['proposal', 15], ['negotiation', 7], ['won', 2]) },
    { id: uid(), name: 'Northwind - production rollout', value: 42000, stage: 'negotiation', contactId: ct.mei, contacts: [{ contactId: ct.mei, role: 'decision-maker' }, { contactId: ct.tomas, role: 'champion' }], companyId: co.northwind, expectedClose: addDays(today, 18), notes: 'Legal has the MSA. Target: end of month.', createdAt: ago(75), updatedAt: ago(3), closedAt: null, stageHistory: hist(['new', 75], ['qualified', 62], ['proposal', 40], ['negotiation', 11]) },
    { id: uid(), name: 'Lumen Health - platform license', value: 3000, billing: 'monthly', term: 12, stage: 'proposal', contactId: ct.priya, contacts: [{ contactId: ct.priya, role: 'influencer' }, { contactId: ct.noor, role: 'blocker' }], companyId: co.lumen, expectedClose: addDays(today, 35), notes: 'Proposal sent; security review is the gate.', createdAt: ago(50), updatedAt: ago(5), closedAt: null, stageHistory: hist(['new', 50], ['qualified', 44], ['proposal', 33]) },
    { id: uid(), name: 'Atlas Freight - full fleet expansion', value: 65000, stage: 'qualified', contactId: ct.dana, companyId: co.atlas, expectedClose: addDays(today, 60), notes: 'Pilot metrics due first. Dana is supportive.', tags: ['expansion'], createdAt: ago(20), updatedAt: ago(4), closedAt: null, stageHistory: hist(['new', 20], ['qualified', 13]) },
    { id: uid(), name: 'Harbor Supply - starter plan', value: 9600, stage: 'new', contactId: ct.alex, companyId: co.harbor, expectedClose: addDays(today, 45), notes: '', createdAt: ago(10), updatedAt: ago(10), closedAt: null, stageHistory: hist(['new', 10]) },
    { id: uid(), name: 'Lumen Health - onboarding services', value: 8000, stage: 'qualified', contactId: ct.noor, companyId: co.lumen, expectedClose: addDays(today, 40), notes: 'Rides on the platform deal.', tags: ['expansion'], createdAt: ago(28), updatedAt: ago(6), closedAt: null, stageHistory: hist(['new', 28], ['qualified', 21]) },
    { id: uid(), name: 'Lena Fischer - post-merger platform', value: 25000, stage: 'new', contactId: ct.lena, companyId: null, expectedClose: addDays(today, 75), notes: 'Waiting on the merger to settle.', createdAt: ago(5), updatedAt: ago(5), closedAt: null, stageHistory: hist(['new', 5]) },
  ];
  const deal = (name) => deals.find((d) => d.name.startsWith(name))?.id ?? null;

  const activities = [
    { id: uid(), type: 'meeting', date: addDays(today, -75), summary: 'Intro demo with Mei and Tomas', notes: 'Strong fit for the assembly line use case. Tomas will champion internally.', contactId: ct.mei, companyId: co.northwind, dealId: deal('Northwind'), createdAt: ago(75) },
    { id: uid(), type: 'call', date: addDays(today, -46), summary: 'Pilot scoping call with Dana', notes: '10 trucks, 6 months. Success metric: 8% fuel savings.', contactId: ct.dana, companyId: co.atlas, dealId: deal('Atlas Freight - fleet pilot'), createdAt: ago(46) },
    { id: uid(), type: 'email', date: addDays(today, -33), summary: 'Sent proposal to Priya', notes: 'Included the SOC 2 report and the security questionnaire answers.', contactId: ct.priya, companyId: co.lumen, dealId: deal('Lumen Health - platform'), createdAt: ago(33) },
    { id: uid(), type: 'meeting', date: addDays(today, -14), summary: 'On-site walkthrough at Northwind', notes: 'Line 2 integration confirmed feasible. Mei wants rollout before their busy season.', contactId: ct.tomas, companyId: co.northwind, dealId: deal('Northwind'), createdAt: ago(14) },
    { id: uid(), type: 'call', date: addDays(today, -7), summary: 'Security review kickoff with Noor', notes: 'Checklist is 40 items; most already covered. Two need engineering input.', contactId: ct.noor, companyId: co.lumen, dealId: deal('Lumen Health - platform'), createdAt: ago(7) },
    { id: uid(), type: 'email', date: addDays(today, -6), summary: 'Pricing questions from Sam', notes: 'Asked about annual discount. Answered; no reply yet.', contactId: ct.sam, companyId: co.quill, dealId: null, createdAt: ago(6) },
    { id: uid(), type: 'meeting', date: addDays(today, -3), summary: 'Negotiation call - Northwind MSA', notes: 'Two redlines left: liability cap and payment terms. Legal reviewing.', contactId: ct.mei, companyId: co.northwind, dealId: deal('Northwind'), createdAt: ago(3) },
    { id: uid(), type: 'note', date: addDays(today, -2), summary: 'Ferrous add-on closed won', notes: 'Jordan signed. Kickoff scheduled with their analyst.', contactId: ct.jordan, companyId: co.ferrous, dealId: deal('Ferrous'), createdAt: ago(2) },
    { id: uid(), type: 'call', date: addDays(today, -1), summary: 'Qualification call with Alex', notes: 'Budget exists this quarter. Needs sign-off from their COO.', contactId: ct.alex, companyId: co.harbor, dealId: deal('Harbor'), createdAt: ago(1) },
  ];

  const tasks = [
    { id: uid(), title: 'Chase Northwind legal on MSA redlines', due: addDays(today, -1), done: false, doneAt: null, contactId: ct.mei, dealId: deal('Northwind'), createdAt: ago(3) },
    { id: uid(), title: 'Send engineering answers for Lumen security checklist', due: today, done: false, doneAt: null, contactId: ct.noor, dealId: deal('Lumen Health - platform'), createdAt: ago(7) },
    { id: uid(), title: 'Book demo with Alex and their COO', due: addDays(today, 2), done: false, doneAt: null, contactId: ct.alex, dealId: deal('Harbor'), createdAt: ago(1) },
    { id: uid(), title: 'Follow up with Sam on pricing thread', due: addDays(today, 3), done: false, doneAt: null, contactId: ct.sam, dealId: null, createdAt: ago(6) },
    { id: uid(), title: 'Prepare pilot metrics deck for Atlas expansion', due: addDays(today, 9), done: false, doneAt: null, contactId: ct.dana, dealId: deal('Atlas Freight - full'), createdAt: ago(4) },
    { id: uid(), title: 'Check in with Lena after merger news', due: addDays(today, 21), done: false, doneAt: null, contactId: ct.lena, dealId: null, repeat: { every: 1, unit: 'month' }, createdAt: ago(5) },
    { id: uid(), title: 'Send SOC 2 report to Priya', due: addDays(today, -33), done: true, doneAt: ago(33), contactId: ct.priya, dealId: deal('Lumen Health - platform'), createdAt: ago(35) },
    { id: uid(), title: 'Schedule Ferrous kickoff', due: addDays(today, -1), done: true, doneAt: ago(1), contactId: ct.jordan, dealId: deal('Ferrous'), createdAt: ago(2) },
  ];

  const templates = [
    { id: uid(), name: 'Quiet-lead check-in', subject: 'Still thinking about {{company}}?', body: 'Hi {{firstName}},\n\nWe spoke a little while back and I wanted to check in. Is this still on your radar?\n\nHappy to pick up where we left off whenever it suits.\n', createdAt: ago(30) },
    { id: uid(), name: 'Post-meeting recap', subject: 'Recap and next steps for {{dealName}}', body: 'Hi {{firstName}},\n\nThanks for the time today. Quick recap of where we landed and what happens next:\n\n- \n- \n\nAnything I missed, just reply here.\n', createdAt: ago(30) },
  ];

  return {
    app: 'crm',
    version: 1,
    // The demo deals reference the default funnel, so the sample ships it -
    // a custom stage list would leave every deal in the first column.
    settings: { ...store.settings, sampleData: true, onboarded: true, stages: null },
    companies,
    contacts,
    deals,
    activities,
    tasks,
    templates,
  };
}

/** One-tap exit from sample mode: everything gone, defaults back, wizard reopens. */
export async function wipeSampleData(store) {
  await store.importAll({
    app: 'crm',
    version: 1,
    settings: { ...store.settings, sampleData: false, onboarded: false },
    companies: [],
    contacts: [],
    deals: [],
    activities: [],
    tasks: [],
  }, { reason: 'wipe' });
}
