"""The decisions the decider is trained for. Question wording here IS the production contract: a model fine-tuned
on these words is calibrated for these words, so production must ask exactly these (packages/ai/src/registry.mjs
for reply_triage). Changing a question means a new task version and a re-fit.

Tasks whose option lists vary per customer (an IVR menu, an ICP's target industries) are trained on random
subsets of the options (always including the right one, plus `other`), so the model learns to pick among
whatever list a customer configures rather than memorising one list.
"""

REPLY_TRIAGE = {
    "version": "reply_triage@1",
    "state_keys": ["subject", "body"],
    "questions": {
        "stop": {"type": "noul", "instructions": "Does the sender ask us to stop contacting them or remove them from a list?"},
        "meet": {"type": "noul", "instructions": "Does the sender ask for or agree to a meeting, call, demo or times?"},
        "label": {"type": "choice", "instructions": "What is the prospect doing in this reply to our sales email?",
                  "criteria": {
                      "meeting_request": "asks for or agrees to a call, meeting, demo or times",
                      "question": "asks a question about the product or offer",
                      "objection_price": "says it costs too much or there is no budget",
                      "objection_timing": "says not now, later, or under contract elsewhere",
                      "referral": "points us to a different person",
                      "out_of_office": "automatic away or leave reply",
                      "not_interested": "declines without asking to stop emails",
                      "unsubscribe": "asks us to stop emailing or remove them",
                      "other": "none of the above"}},
    },
}

# An IVR / phone-agent menu. Customers rename and drop departments; training samples subsets.
IVR_DEPARTMENTS = {
    "sales": "wants to buy, sign up, get a quote or pricing for something new",
    "billing": "charges, payments, fees, refunds or invoices",
    "support": "something is broken, missing, late or not working, or how to use an existing service",
    "scheduling": "book, change or cancel an appointment or reservation",
    "account": "login, password, PIN, identity, profile or personal details",
    "cancel": "wants to cancel an order, close the account or end the service",
    "other": "none of these",
}
IVR_ROUTE = {
    "version": "ivr_route@1",
    "state_keys": ["transcript"],
    "questions": {
        "department": {"type": "choice", "instructions": "Which department should take this caller?", "criteria": IVR_DEPARTMENTS},
        "human": {"type": "noul", "instructions": "Does the caller ask to speak to a person?"},
    },
}

BOOKING = {
    "version": "booking@1",
    "state_keys": ["body"],
    "questions": {
        "action": {"type": "choice", "instructions": "What does the sender want to do about a booking?",
                   "criteria": {
                       "book": "book or schedule a new appointment, call, meeting or reservation",
                       "reschedule": "move an existing booking to another time",
                       "cancel": "cancel a booking",
                       "availability": "ask what times are open, or check an existing booking",
                       "confirm": "confirm or accept a proposed time",
                       "none": "nothing about a booking"}},
        "wants_time": {"type": "noul", "instructions": "Does the sender ask to book, move or confirm a time?"},
    },
}

# NAICS 2022 sectors. ICP questions name the customer's target industries; training samples subsets of these.
NAICS_SECTORS = {
    "11": "agriculture, forestry, fishing and hunting",
    "21": "mining, quarrying, and oil and gas extraction",
    "22": "utilities",
    "23": "construction and the trades",
    "31": "manufacturing", "32": "manufacturing", "33": "manufacturing",
    "42": "wholesale trade",
    "44": "retail trade", "45": "retail trade",
    "48": "transportation and warehousing", "49": "transportation and warehousing",
    "51": "information, media and software publishing",
    "52": "finance and insurance",
    "53": "real estate, rental and leasing",
    "54": "professional, scientific and technical services",
    "55": "management of companies",
    "56": "administrative, staffing, cleaning and waste services",
    "61": "educational services",
    "62": "health care and social assistance",
    "71": "arts, entertainment and recreation",
    "72": "accommodation and food services",
    "81": "repair, personal care and other services",
    "92": "public administration",
}
ICP_INDUSTRY = {
    "version": "icp_industry@1",
    "state_keys": ["business"],
    "question": lambda options: {"type": "choice", "instructions": "Which industry is this business in?", "criteria": options},
}

# Department of a job title (O*NET SOC major group, with the management group split by function).
DEPARTMENTS = {
    "executive": "owner, founder or chief executive",
    "sales": "sales and business development",
    "marketing": "marketing, advertising and communications",
    "operations": "operations, logistics and facilities",
    "finance": "finance, accounting and purchasing",
    "it_engineering": "IT, software and engineering",
    "hr": "people, HR and recruiting",
    "clinical": "doctors, nurses, dentists and other clinicians",
    "admin": "office, front desk and administrative support",
    "trades": "construction, installation, repair and production",
    "other": "none of these",
}
ICP_DEPARTMENT = {
    "version": "icp_department@1",
    "state_keys": ["job_title"],
    "question": lambda options: {"type": "choice", "instructions": "Which department does this job title belong to?", "criteria": options},
}

MAX_OPTIONS = 10  # the shipped checkpoint's temperatures for 11+ options are clamped and uncalibrated
