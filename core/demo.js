// Demo data so every part of Maestro works the moment it is installed.
// Items are written like real notifications so the workshop can show exactly how the
// intelligence feed, briefings and challenges behave once real connectors are attached.

// minutesAgo is relative to when the feed is seeded.
const SEED = [
  // Calls hub: video calls and phone
  { source: 'zoom', profile: 'business', minutesAgo: 95, category: 'CALL', title: 'Zoom: Acme Corp discovery call summary ready', quote: 'AI summary: "Alex wants pricing for 250 seats and SSO before Friday."', summary: '2 action items identified', priority: 'High', actions: ['Draft pricing reply', 'Add SSO question to PRD'] },
  { source: 'teams', profile: 'business', minutesAgo: 140, category: 'CALL', title: 'Missed Teams call from Priya Shah', quote: 'Priya: "Ping me when you have the roadmap numbers."', summary: 'Before the Q3 roadmap review', priority: 'Medium', actions: ['Call Priya back'] },
  { source: 'google_meet', profile: 'business', minutesAgo: 30, category: 'CALL', title: 'Google Meet: Daily standup transcript saved', quote: 'Marcus: "Still blocked on the Payment SDK. Need a decision today."', summary: 'Blocker on Sprint 24', actions: ['Open transcript'] },
  { source: 'zoom', profile: 'personal', minutesAgo: 300, category: 'CALL', title: 'Zoom: Family call with Mom scheduled Sunday 5 PM', quote: '"Kids want to show grandma their soccer medals."', summary: 'Added to your calendar' },
  // Messages hub: WhatsApp
  { source: 'whatsapp', profile: 'personal', minutesAgo: 12, category: 'SMS', title: 'WhatsApp from Sam', quote: '"Tennis Saturday 10am? I booked court 3 🎾"', summary: 'Saturday 10 AM is free', unread: true, actions: ['Reply yes'] },
  { source: 'whatsapp', profile: 'business', minutesAgo: 75, category: 'SMS', title: 'WhatsApp from Jordan Patel', quote: '"API partner can do the demo Tuesday or Wednesday, which works?"', summary: 'Needs a reply today', priority: 'Medium', actions: ['Reply Tuesday'] },
  // ---------------- Business ----------------
  { source: 'twilio_calls', profile: 'business', minutesAgo: 4, category: 'CALL', title: 'Missed call from Alex Chen (Acme Corp)', quote: 'Voicemail: "Hey, calling about the renewal pricing, can we talk before Friday?"', summary: 'Renewal at risk if not answered this week', priority: 'High', deadline: 'Call back today', actions: ['Call Alex back', 'Draft pricing reply'] },
  { source: 'gcal', profile: 'business', minutesAgo: 6, category: 'MEETING', title: 'Sprint Review starts in 30 min', quote: 'Attendees: Priya Shah, Marcus Lee, Sarah Kim, +4', summary: 'Prep notes ready in Meetings/Sprint 24 Review', priority: 'Medium', deadline: 'Starts 10:30 AM', actions: ['Open prep notes'] },
  { source: 'slack', profile: 'business', minutesAgo: 18, category: 'CONVERSATION', title: 'New message from Sarah (Slack)', quote: '"Can you review the latest designs when you get a chance?"', summary: '2 action items identified', unread: true, actions: ['Review Checkout v3', 'Reply to Sarah'] },
  { source: 'outlook', profile: 'business', minutesAgo: 24, category: 'EMAIL', title: 'Priya Shah: Q3 roadmap review moved to Thursday', quote: '"Can you bring the updated roadmap and the notifications PRD?"', summary: 'Needs updated roadmap deck by Wednesday EOD', priority: 'High', deadline: 'Due Wed', actions: ['Add task', 'Draft reply'] },
  { source: 'system', profile: 'business', minutesAgo: 28, category: 'PROJECT', title: 'Project Update', quote: 'Mobile App Redesign', summary: '3 tasks completed • 75% progress', progress: 75 },
  { source: 'slack', profile: 'business', minutesAgo: 41, category: 'CONVERSATION', title: '#eng-mobile: Marcus flagged a blocker', quote: '"Payment SDK v5 migration is blocking the release. Need a scope call today."', summary: 'Blocker on Sprint 24 goal', priority: 'High', unread: true, actions: ['Decide scope', 'Log decision'] },
  { source: 'email', profile: 'business', minutesAgo: 55, category: 'EMAIL', title: 'Support escalation: Northwind cannot export reports', quote: '"Third ticket this week. Customer threatens to churn."', summary: 'Linked to known bug EXP-77', priority: 'High', deadline: 'SLA 4h' },
  { source: 'system', profile: 'business', minutesAgo: 70, category: 'TASK', title: 'Write PRD: Smart Notifications', quote: 'From Tasks/Inbox.md', summary: 'Draft started in Projects/Smart Notifications PRD', priority: 'High', deadline: 'Due today' },
  { source: 'icalendar', profile: 'business', minutesAgo: 120, category: 'MEETING', title: '1:1 with Jordan moved to 3:00 PM', quote: 'Topic: career growth and the API platform handoff', summary: 'Last 1:1 notes in People/Jordan Patel' },

  // ---------------- Personal ----------------
  { source: 'twilio_sms', profile: 'personal', minutesAgo: 3, category: 'SMS', title: 'Text from Mom', quote: '"Dinner Sunday at 6? Bring the kids!"', summary: 'Conflicts with nothing on your calendar', unread: true, actions: ['Reply yes', 'Add to calendar'] },
  { source: 'gmail', profile: 'personal', minutesAgo: 15, category: 'EMAIL', title: 'Air Canada: Flight to Toronto confirmed', quote: 'AC 1142 • Fri 7:05 AM • Seat 14C', summary: 'Check-in opens Thursday 7:05 AM', deadline: 'Fri 7:05 AM', actions: ['Add check-in reminder'] },
  { source: 'icalendar', profile: 'personal', minutesAgo: 30, category: 'MEETING', title: 'Gym: Leg day at 6:30 PM', quote: 'Streak: 2 sessions this week', summary: 'Goal is 4 per week' },
  { source: 'twilio_calls', profile: 'personal', minutesAgo: 48, category: 'CALL', title: 'Missed call from Dr. Patel’s office', quote: 'Voicemail: "Reminder to book your annual check-up."', summary: 'Booking line closes at 5 PM', priority: 'Medium', deadline: 'Today 5 PM' },
  { source: 'gmail', profile: 'personal', minutesAgo: 80, category: 'EMAIL', title: 'Passport renewal reminder', quote: 'Your passport expires in 4 months', summary: 'Needed for September trip', priority: 'Medium', deadline: 'Renew by Fri' },

  // ---------------- Role pack sources ----------------
  { source: 'linear', profile: 'business', minutesAgo: 12, category: 'TASK', title: 'MOB-142 blocked: Payment SDK v5 migration', quote: 'Assignee: Marcus Lee • Sprint 24', summary: 'Blocking 2 other issues', priority: 'High', deadline: 'Sprint ends Fri', pack: 'product-manager' },
  { source: 'linear', profile: 'business', minutesAgo: 35, category: 'PROJECT', title: 'Sprint 24 progress', quote: '18 of 26 points done • 2 days left', summary: '3 issues at risk', progress: 69, pack: 'product-manager' },
  { source: 'jira', profile: 'business', minutesAgo: 62, category: 'TASK', title: 'PLAT-88 moved to QA', quote: 'Bulk export API', summary: 'Unblocks Northwind escalation', pack: 'product-manager' },
  { source: 'notion', profile: 'business', minutesAgo: 75, category: 'PROJECT', title: 'PRD: Smart Notifications edited by Sarah', quote: '4 new comments on "Quiet hours"', summary: 'Open questions need PM decision', pack: 'product-manager' },
  { source: 'figma', profile: 'business', minutesAgo: 9, category: 'CONVERSATION', title: 'Checkout v3: 4 unresolved comments', quote: 'Marcus: "Button states missing for loading and error"', summary: 'Blocking developer handoff', priority: 'High', pack: 'designer' },
  { source: 'gdrive', profile: 'business', minutesAgo: 44, category: 'PROJECT', title: 'Usability test notes: Round 2 shared with you', quote: '6 participants • 14 observations', summary: 'Ready for research synthesis', pack: 'designer' },
  { source: 'github', profile: 'business', minutesAgo: 7, category: 'TASK', title: 'PR #412 "Offline sync" awaiting your review', quote: '2 approvals • 1 requested change', summary: 'Merging unblocks v2.4 release', priority: 'High', pack: 'entrepreneur' },
  { source: 'github', profile: 'business', minutesAgo: 22, category: 'TASK', title: 'CI failing on main', quote: '3 tests failing in payments/checkout.spec.ts', summary: 'Started after commit a91f3c2', priority: 'High', pack: 'entrepreneur' },
  { source: 'docs', profile: 'business', minutesAgo: 90, category: 'PROJECT', title: 'API reference out of date', quote: '5 endpoints changed since last publish', summary: 'Release notes needed for v2.4', pack: 'entrepreneur' },
];

// New items that "arrive" while the dashboard is open (one every ~35s) to show the live feed.
const STREAM = [
  { source: 'slack', profile: 'business', category: 'CONVERSATION', title: 'Priya mentioned you in #product', quote: '"@Ryan can we get a one-line status on Smart Notifications for the exec update?"', summary: '1 action item identified', unread: true, actions: ['Draft status'] },
  { source: 'outlook', profile: 'business', category: 'EMAIL', title: 'Finance: Q3 budget template due Monday', quote: '"Please submit headcount and tooling asks."', summary: 'Recurring quarterly task', deadline: 'Due Mon' },
  { source: 'gcal', profile: 'business', category: 'MEETING', title: 'New invite: Design critique, Thu 2 PM', quote: 'From Sarah Kim • Checkout v3', summary: 'No conflicts', actions: ['Accept'] },
  { source: 'twilio_calls', profile: 'business', category: 'CALL', title: 'Call from Jordan Patel (2 min)', quote: 'Transcript: "Quick heads-up, the API partner wants a demo next week."', summary: 'Follow-up task created' },
  { source: 'email', profile: 'business', category: 'EMAIL', title: 'Customer feedback digest', quote: '12 new NPS responses • score 41 (+3)', summary: 'Top theme: notification overload' },
  { source: 'slack', profile: 'business', category: 'CONVERSATION', title: '#eng-mobile: Marcus', quote: '"Release candidate is green except payments."', summary: 'Blocker still open' },
  { source: 'linear', profile: 'business', category: 'TASK', title: 'MOB-150 created: Notification quiet hours', quote: 'Created by Sarah Kim from PRD comments', summary: 'Needs estimate', pack: 'product-manager' },
  { source: 'figma', profile: 'business', category: 'CONVERSATION', title: 'Sarah resolved 2 comments on Checkout v3', quote: 'Loading states added', summary: '2 comments left before handoff', pack: 'designer' },
  { source: 'github', profile: 'business', category: 'TASK', title: 'Issue #530 opened: Login loop on Android 15', quote: 'Reported by 4 users', summary: 'Labelled bug, P1', priority: 'High', pack: 'entrepreneur' },
  { source: 'twilio_sms', profile: 'personal', category: 'SMS', title: 'Text from Sam', quote: '"Still on for tennis Saturday 10am?"', summary: 'Saturday 10 AM is free', unread: true, actions: ['Reply yes'] },
  { source: 'gmail', profile: 'personal', category: 'EMAIL', title: 'Amazon: Your order has shipped', quote: 'Arriving Wednesday', summary: 'No action needed' },
  { source: 'icalendar', profile: 'personal', category: 'MEETING', title: 'Reminder: Kids soccer Saturday 9 AM', quote: 'Your turn to bring snacks', summary: 'Added to shopping list', actions: ['Add to list'] },
];

function calendarEvents(profile, now = new Date()) {
  const day = (offsetDays, h, m) => { const d = new Date(now); d.setDate(d.getDate() + offsetDays); d.setHours(h, m, 0, 0); return d; };
  const ev = (source, dOff, h, m, dur, title, extra = {}) => ({ source, title, start: day(dOff, h, m).toISOString(), end: new Date(day(dOff, h, m).getTime() + dur * 60000).toISOString(), ...extra });
  if (profile === 'personal') {
    return [
      ev('icalendar', 0, 7, 0, 30, 'Morning run'),
      ev('icalendar', 0, 18, 30, 60, 'Gym: Leg day', { location: 'GoodLife Fitness' }),
      ev('icalendar', 1, 12, 0, 60, 'Lunch with Sam'),
      ev('gmail', 2, 7, 5, 120, 'Flight AC 1142 to Toronto', { location: 'YVR' }),
      ev('icalendar', 3, 9, 0, 90, 'Kids soccer', { location: 'Riverside Park' }),
      ev('icalendar', 4, 18, 0, 120, 'Dinner at Mom’s'),
    ];
  }
  return [
    ev('gcal', 0, 9, 0, 15, 'Daily standup', { attendees: ['Marcus Lee', 'Sarah Kim', 'Dev team'] }),
    ev('gcal', 0, 10, 30, 60, 'Sprint 24 Review', { attendees: ['Priya Shah', 'Marcus Lee', 'Sarah Kim'], notes: 'Meetings/Sprint 24 Review' }),
    ev('outlook', 0, 13, 0, 30, 'Acme Corp renewal call', { attendees: ['Alex Chen'] }),
    ev('icalendar', 0, 15, 0, 30, '1:1 with Jordan', { notes: 'People/Jordan Patel' }),
    ev('gcal', 1, 11, 0, 60, 'Smart Notifications PRD review', { attendees: ['Sarah Kim', 'Marcus Lee'] }),
    ev('outlook', 2, 14, 0, 60, 'Design critique: Checkout v3', { attendees: ['Sarah Kim'] }),
    ev('outlook', 3, 10, 0, 90, 'Q3 roadmap review', { attendees: ['Priya Shah', 'Leadership'] }),
  ];
}

module.exports = { SEED, STREAM, calendarEvents };
