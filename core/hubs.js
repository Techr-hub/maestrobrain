// The five default hubs on the brain map. Every brain has them; each connected source attaches to its hub.
const HUBS = [
  { id: 'email', name: 'Email', short: 'EM', color: '#ffb020', members: ['gmail', 'outlook', 'email'], categories: ['EMAIL'] },
  { id: 'calendar', name: 'Calendar', short: 'CA', color: '#00e5ff', members: ['icalendar', 'gcal', 'outlook'], categories: ['MEETING'], calendar: true },
  { id: 'messages', name: 'Messages', short: 'MS', color: '#c42cff', members: ['slack', 'twilio_sms'], categories: ['CONVERSATION', 'SMS'] },
  { id: 'calls', name: 'Calls', short: 'CL', color: '#ff7a45', members: ['twilio_calls'], categories: ['CALL'] },
  { id: 'projects', name: 'Projects', short: 'PR', color: '#00f2af', members: ['linear', 'jira', 'notion', 'github', 'figma', 'gdrive', 'docs'], categories: ['PROJECT', 'TASK'], projects: true },
];
module.exports = { HUBS };
