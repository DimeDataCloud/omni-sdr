// Tenant config: swap this object to change the niche. Everything below is FICTIONAL demo data.
export const TENANTS = {
  riverbend: {
    id: 'riverbend',
    business: 'Riverbend Bath',
    owner: 'Mike',
    persona: 'Jess',
    niche: 'Bathroom remodeler',
    hours: 'Mon to Fri, 8 to 5',
    serviceZips: ['37201','37203','37204','37205','37206','37207','37208','37209','37210','37211','37212','37215','37216','37217','37220','37221'],
    services: [
      { key: 'tub-to-shower', label: 'tub to shower conversion', words: ['tub to shower','convert','walk-in','walk in','accessible','grab bar','curbless'] },
      { key: 'full-remodel', label: 'full bathroom remodel', words: ['full','gut','remodel','renovat','whole','complete'] },
      { key: 'refresh', label: 'tile or fixture refresh', words: ['tile','vanity','fixture','faucet','refresh','paint','update'] },
      { key: 'repair', label: 'repair or water damage', words: ['leak','water','damage','mold','repair','rot'] }
    ],
    outOfScope: ['kitchen','roof','deck','basement','pool','fence'],
    estimate: 'a free in-home estimate, about 45 minutes',
    license: 'licensed and insured (demo placeholder)',
    slots: ['Tuesday at 10:00 AM', 'Wednesday at 2:00 PM', 'Thursday at 9:00 AM'],
    hot: ['asap','urgent','this month','next month','leak','flood','water damage','fall','fell','mobility','wheelchair','walker','another quote','got a quote'],
    quietHours: [21, 8],
    // From Muse's niche hunt SOPs (Oct 24, 2026). Config only; the scripted agent already obeys the first three.
    hardStops: ['Never quote a price, range or financing terms', 'Never promise a start date or warranty terms', 'Never close or take payment; only book the free estimate', 'AI disclosure and recording notice on every call'],
    emergencyFlag: ['active leak', 'water damage', 'fall or mobility emergency'],
    discovery: ['Who answers the phone today: you, family, a service, voicemail?', 'Any answering contract, and is it month-to-month?', 'What software runs the business (Jobber, Housecall Pro, other)?', 'Who else in the trade has this problem (peer names)?', 'What carries the fee through your slowest month?'],
    measure: ['kept jobs / booked estimates', 'after-hours share of calls on the pilot line', 'peer-name yield per pilot']
  }
};
export const DEFAULT_TENANT = 'riverbend';
