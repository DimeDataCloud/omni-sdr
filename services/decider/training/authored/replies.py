"""Authored training rows: reply_triage@1 (none existed), booking@1 reschedule/confirm (none existed) and the IVR
"ask for a person" question (one source only). $0: no model call writes or labels anything.

Each hand-written core (cores.py) is wrapped the way real mail arrives: a greeting, the sender's signature, a phone
footer, a legal disclaimer, and OUR email quoted underneath in Gmail, Outlook, Apple Mail or "Original Message"
style. Our quoted email asks for a call and carries "reply STOP" and an unsubscribe link, so the model has to learn
that only the sender's own words count (the trap PR #31 found in the rules). Some rows are left clean, the shape
production sends after cleanReplyBody. Some carry an injected instruction; the gold never moves.

Splits are honest: a core is in test or in train, never both (stable hash), and a fifth of every wrapper list
(signatures, disclaimers, quote styles, pitches, injections) is used only in test. So test rows are unseen phrasing
in unseen packaging.
"""
import hashlib, random, re

from . import cores as C

FIRST = ["Dana", "Mike", "Priya", "Luis", "Grace", "Tom", "Aisha", "Ben", "Carmen", "Derek", "Elena", "Frank", "Hana",
         "Ivan", "Jada", "Kevin", "Lena", "Marco", "Nora", "Omar", "Paula", "Quinn", "Rosa", "Sam", "Tara", "Vic", "Wes", "Yuki"]
LAST = ["Ellis", "Reyes", "Patel", "Nguyen", "Okafor", "Brandt", "Kowalski", "Haddad", "Moreno", "Fischer", "Lindqvist",
        "Tanaka", "Abara", "Costa", "Dubois", "Grant"]
COMPANY = ["Ridgeline Roofing", "Harbor Dental", "Bluebird HVAC", "Northside Plumbing", "Cedar Vet Clinic", "Summit Law",
           "Maple Street Bakery", "Ironwood Auto", "Brightpath Tutoring", "Lakeside Property Group", "Pinecrest Realty",
           "Copperline Electric", "Westgate Fitness", "Oakmont Pediatrics", "Riverbend Landscaping", "Keystone Insurance"]
CITY = ["Nashville", "Tulsa", "Boise", "Raleigh", "Dayton", "Fresno", "Omaha", "Tucson", "Spokane", "Chattanooga"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
TIMES = ["9", "10am", "10:30", "11", "1pm", "2", "2:30", "3pm", "4", "4:15"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
SEASONS = ["the holidays", "busy season", "tax season", "the summer", "year end", "the new year"]
DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "septiembre", "octubre", "noviembre"]

SUBJECTS = ["quick idea", "missed calls at {company}", "following up", "question for you", "{company} + Omni",
            "after-hours calls", "idea for {company}", "hold times", "15 minutes?", "your front desk", "one more thing",
            "saw your reviews", "new patients", "re-booking", "a thought"]
OOO_SUBJECTS = ["Automatic reply: {s}", "Out of Office: {s}", "Auto-Reply: {s}", "Autoreply: Re: {s}", "Away: {s}",
                "Out of office", "Automatic reply"]

GREET = ["", "", "", "Hi {us},\n\n", "Hello,\n\n", "{us},\n\n", "Hey {us} -\n\n", "Good morning,\n\n", "Hi there,\n\n"]
CLOSE = ["", "", "\n\nThanks", "\n\nThanks,\n{first}", "\n\nBest,\n{first}", "\n\n- {first}", "\n\nRegards,\n{first} {last}",
         "\n\nCheers", "\n\n{first}", "\n\nThank you,\n{first}"]
SIGNATURE = [
    "\n\n{first} {last}\nOffice Manager | {company}\n(555) 01{n}-01{n}\nwww.{dom}",
    "\n\n--\n{first} {last}\nOwner, {company}\n{city}",
    "\n\n{first} {last} | Operations\n{company}\nP: 555-01{n}-23{n}  F: 555-01{n}-23{n}",
    "\n\n{FIRST} {LAST}\n{company}\n\"Serving {city} since 1998\"",
    "\n\n{first}\n{company} | {city}\nFollow us on social for specials!",
    "\n\n{first} {last}, DDS\n{company}",
    "\n\n__\n{first} {last}\nGeneral Manager\n{company}\nemail: {me}",
    "\n\n{first} {last}\n{company}\nTo unsubscribe from our newsletter, update your preferences at {dom}/prefs",
    "\n\nWarm regards,\n{first} {last}\nPractice Administrator\n{company}",
    "\n\n{first} {last}\nSent on behalf of {company}. Please consider the environment before printing this email.",
]
PHONE = ["", "", "", "\n\nSent from my iPhone", "\n\nSent from my Galaxy", "\n\nGet Outlook for iOS",
         "\n\nSent from Yahoo Mail for Android", "\n\nSent from my iPad"]
DISCLAIMER = [
    "", "", "", "",
    "\n\nCONFIDENTIALITY NOTICE: This e-mail and any attachments are for the sole use of the intended recipient(s) and may "
    "contain confidential information. If you are not the intended recipient, please contact the sender and delete all copies.",
    "\n\nThis message may contain privileged information. If received in error, notify the sender immediately and delete it.",
    "\n\nPHI WARNING: Do not send patient information by email. Call our office instead.",
    "\n\nThe information in this email is confidential. Unauthorized use, disclosure or distribution is prohibited.",
    "\n\nPlease do not reply to this email with payment card details.",
]
PITCH = [
    "Hi {first},\n\nNoticed {company} misses calls after 5pm. Omni answers them, books the job and texts you a summary.\n\n"
    "Worth a 15-minute call {day}?\n\n{us}\nOmni\n\nReply STOP to opt out.",
    "{first} - most {city} shops lose 1 in 5 calls to voicemail. We fix that without hiring.\n\nOpen to a quick demo this "
    "week?\n\n{us}\n\nUnsubscribe: https://omnisdr.example/u/{tok}",
    "Hi {first}, following up on my note last week. Happy to show you how Omni books appointments while you're on a job. "
    "Grab a time here: https://cal.example/{us_l}\n\nIf you'd rather not hear from me, just reply and I'll stop.",
    "Hello {first},\n\nWould it make sense to talk about your front desk workload? I can share what similar practices "
    "did.\n\nBest,\n{us}\n\nDon't want these emails? Unsubscribe here: https://omnisdr.example/u/{tok}",
    "{first}, quick one: who handles your phones at {company}? If it's you, 15 minutes {day} could save you hours a week.\n\n"
    "{us}, Omni\n\nTo stop receiving emails from us, reply 'remove'.",
]
QUOTE = [
    lambda d: f"\n\nOn {d['day']}, {d['mon']} {d['dd']}, 2026 at {d['qt']} {d['us']} <{d['us_l']}@omnisdr.example> wrote:\n" + quoted(d['pitch']),
    lambda d: f"\n\n________________________________\nFrom: {d['us']} <{d['us_l']}@omnisdr.example>\nSent: {d['day']}, {d['mon']} {d['dd']}, 2026 {d['qt']}\nTo: {d['first']} {d['last']} <{d['me']}>\nSubject: {d['subj']}\n\n{d['pitch']}",
    lambda d: f"\n\n-----Original Message-----\nFrom: {d['us']} [mailto:{d['us_l']}@omnisdr.example]\nSent: {d['mon']} {d['dd']}, 2026\nSubject: {d['subj']}\n\n{d['pitch']}",
    lambda d: f"\n\n> On {d['mon'][:3]} {d['dd']}, 2026, at {d['qt']}, {d['us']} <{d['us_l']}@omnisdr.example> wrote:\n> \n" + quoted(d['pitch']),
    lambda d: f"\n\n---- On {d['day'][:3]}, {d['dd']} {d['mon'][:3]} 2026 {d['qt']} {d['us']} wrote ----\n" + quoted(d['pitch']),
]
US = ["Jordan", "Alex Rivera", "Casey", "Morgan Lee", "Riley"]


def quoted(text):
    return "\n".join(f"> {line}" if line else ">" for line in text.split("\n"))


def h(s):
    return int(hashlib.sha256(s.encode()).hexdigest(), 16)


def split_of(core):
    return "test" if h("core:" + core) % 5 == 0 else "train"


def pick(rng, items, split):
    """Wrapper choice: test rows use only the held-out fifth of each list (by index), train rows the rest. Empty
    strings ("no wrapper") are shared by both."""
    pool = [x for i, x in enumerate(items) if (x == "" or (i % 5 == 4) == (split == "test"))]
    return rng.choice(pool or items)


def fill(rng, text, es=False):
    first2, last2, comp = rng.choice(FIRST), rng.choice(LAST), rng.choice(COMPANY)
    dom = re.sub(r"[^a-z]", "", comp.lower())[:14] + ".example"
    d1, d2 = rng.sample(DAYS, 2)
    vals = {"first": rng.choice(FIRST), "name2": f"{first2} {last2}" if rng.random() < 0.5 else first2,
            "email2": f"{first2.lower()}@{dom}", "company": comp, "day": d1, "day2": d2, "time": rng.choice(TIMES),
            "date": f"{rng.choice(MONTHS)} {rng.randint(2, 28)}", "month": rng.choice(MONTHS), "season": rng.choice(SEASONS),
            "n": str(rng.randint(2, 9)), "price": str(rng.choice([99, 149, 199, 250, 300, 500])), "city": rng.choice(CITY),
            "dia": rng.choice(DIAS), "hora": rng.choice(["las 10", "las 3", "mediodía"]), "mes": rng.choice(MESES),
            "fecha": f"{rng.randint(2, 28)} de {rng.choice(MESES)}"}
    return re.sub(r"\{(\w+)\}", lambda m: vals.get(m.group(1), m.group(0)), text)


def noise(rng, text):
    r = rng.random()
    if r < 0.08:
        return text.lower()
    if r < 0.12:
        return text.rstrip(".!")
    if r < 0.16 and len(text) > 12:  # one adjacent-letter swap, the commonest typo
        i = rng.randrange(1, len(text) - 2)
        if text[i].isalpha() and text[i + 1].isalpha():
            return text[:i] + text[i + 1] + text[i] + text[i + 2:]
    return text


def reply_mail(rng, core_text, label, split, es=False):
    """(subject, body) for one reply, shaped like real mail. Returns the shape name for the stats."""
    first, last, comp, city = rng.choice(FIRST), rng.choice(LAST), rng.choice(COMPANY), rng.choice(CITY)
    us = rng.choice(US)
    dom = re.sub(r"[^a-z]", "", comp.lower())[:14] + ".example"
    ctx = {"first": first, "last": last, "FIRST": first.upper(), "LAST": last.upper(), "company": comp, "city": city,
           "us": us.split()[0], "dom": dom, "me": f"{first.lower()}@{dom}", "n": str(rng.randint(10, 99))}
    fmt = lambda t: re.sub(r"\{(\w+)\}", lambda m: ctx.get(m.group(1), m.group(0)), t)
    subj = fill(rng, rng.choice(SUBJECTS)).replace("{company}", comp)
    subject = fmt(rng.choice(OOO_SUBJECTS).replace("{s}", subj)) if label == "out_of_office" else ("Re: " if rng.random() < 0.9 else "RE: ") + subj
    body = noise(rng, fill(rng, core_text))
    shape = "clean"
    if label == "out_of_office":
        body = fmt(f"{body}\n\n{first} {last}\n{comp}") if rng.random() < 0.6 else body
        shape = "auto"
    elif rng.random() < 0.6:
        shape = "raw"
        body = fmt(pick(rng, GREET, split)) + body + fmt(pick(rng, CLOSE, split))
        if rng.random() < 0.5:
            body += fmt(pick(rng, SIGNATURE, split))
        body += pick(rng, PHONE, split) + pick(rng, DISCLAIMER, split)
    if label != "out_of_office" and rng.random() < (0.7 if shape == "raw" else 0.15):
        mon, dd = rng.choice(MONTHS), rng.randint(1, 28)
        pitch = fill(rng, pick(rng, PITCH, split)).replace("{us}", us).replace("{tok}", f"{h(core_text + str(dd)) % 10**8:08d}")
        pitch = pitch.replace("{us_l}", us.split()[0].lower()).replace(f"{{first}}", first)
        d = {"day": rng.choice(DAYS), "mon": mon, "dd": dd, "qt": rng.choice(["9:14 AM", "2:02 PM", "11:47 AM", "4:30 PM"]),
             "us": us, "us_l": us.split()[0].lower(), "pitch": pitch, "first": first, "last": last, "me": ctx["me"], "subj": subj}
        body += pick(rng, QUOTE, split)(d)
        shape += "+quote"
    return subject, body, shape


def golden_keys():
    """Letters-only bodies of the held-out golden sets: an authored core equal to one is never trained on."""
    import glob, json, os
    keys = set()
    for p in glob.glob(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "golden", "*.jsonl")):
        for line in open(p, encoding="utf-8"):
            keys.add(re.sub(r"[^a-záéíóúñü]", "", json.loads(line)["body"].lower()))
    return keys


def add_reply_triage(out, row, seed=11, per_core=40, per_core_es=14):
    """reply_triage@1 rows from every core. Returns the number of rows offered (dedup happens in `out`)."""
    import tasks as T
    held_out = golden_keys()
    rt = T.REPLY_TRIAGE
    rng = random.Random(seed)
    labels = rt["questions"]["label"]["criteria"]
    n = 0
    for lang, table, k in (("en", C.REPLY, per_core), ("es", C.REPLY_ES, per_core_es)):
        for label, items in table.items():
            for ci, core in enumerate(items):
                if re.sub(r"[^a-záéíóúñü]", "", core.lower()) in held_out:
                    continue
                split = split_of(core)
                for v in range(k):
                    subject, body, shape = reply_mail(rng, core, label, split, es=lang == "es")
                    inj = ""
                    if label != "other" and rng.random() < 0.08:
                        inj = pick(rng, C.INJECTIONS, split)
                        body = f"{inj}\n{body}" if rng.random() < 0.5 else body.replace("\n\n", f"\n\n{inj}\n\n", 1) if "\n\n" in body else f"{body} {inj}"
                    gold = {"stop": {"probabilities": {"true": float(label == "unsubscribe"), "false": float(label != "unsubscribe")}},
                            "meet": {"probabilities": {"true": float(label == "meeting_request"), "false": float(label != "meeting_request")}},
                            "label": {"probabilities": {key: float(key == label) for key in labels}}}
                    r = row(rt["version"], f"authored:{lang}:{shape}{':inject' if inj else ''}", {"subject": subject, "body": body},
                            rt["questions"], gold, split, f"auth-rt-{lang}-{label}-{ci}-{v}")
                    out.add(r, subject + "\n" + body)
                    n += 1
    return n


def add_booking(out, row, seed=12, per_core=40):
    import tasks as T
    bk = T.BOOKING
    rng = random.Random(seed)
    n = 0
    for action, items in C.BOOKING.items():
        for ci, core in enumerate(items):
            split = split_of(core)
            for v in range(per_core):
                body = noise(rng, fill(rng, core))
                if rng.random() < 0.5:
                    first = rng.choice(FIRST)
                    body = rng.choice(["", "Hi,\n\n", "Hello,\n\n", "Hi there - "]) + body + rng.choice(["", f"\n\nThanks,\n{first}", f"\n\n{first} {rng.choice(LAST)}", "\n\nSent from my iPhone"])
                g = {"action": {"probabilities": {k: float(k == action) for k in bk["questions"]["action"]["criteria"]}},
                     "wants_time": {"probabilities": {"true": float(action in ("book", "reschedule", "confirm")),
                                                      "false": float(action not in ("book", "reschedule", "confirm"))}}}
                out.add(row(bk["version"], "authored:en", {"body": body}, bk["questions"], g, split, f"auth-bk-{action}-{ci}-{v}"), body)
                n += 1
    return n


FILLERS = ["", "", "uh ", "um ", "yeah ", "hi ", "hello yes ", "okay so ", "hi um "]
TAILS = ["", "", " please", " thanks", " thank you", " i've been on hold forever", " real quick"]


def add_ivr_human(out, row, subset, seed=13, per_core=16):
    import tasks as T
    ivr = T.IVR_ROUTE
    rng = random.Random(seed)
    n = 0
    for ci, (dept, human, core) in enumerate(C.IVR_HUMAN):
        split = split_of(core)
        for v in range(per_core):
            text = rng.choice(FILLERS) + core + rng.choice(TAILS)
            crit, gold_key = subset(rng, T.IVR_DEPARTMENTS, dept, k_min=4, k_max=7)
            q = {"department": {**ivr["questions"]["department"], "criteria": crit}, "human": ivr["questions"]["human"]}
            g = {"department": {"probabilities": {k: float(k == gold_key) for k in crit}},
                 "human": {"probabilities": {"true": float(human), "false": float(1 - human)}}}
            out.add(row(ivr["version"], "authored:en", {"transcript": text}, q, g, split, f"auth-ivr-{ci}-{v}"), text)
            n += 1
    return n


def add_titles(out, row, subset, seed=14):
    """icp_department@1 titles for the departments O*NET is thin on (executive 84, marketing 294, hr 260 in v1):
    seniority x function, both hand-listed in cores.TITLES. Split by function word, so test titles use function
    words never seen in train."""
    import tasks as T
    dep = T.ICP_DEPARTMENT
    rng = random.Random(seed)
    n = 0
    for dept, (heads, funcs, exact) in C.TITLES.items():
        titles = {(t, t) for t in exact}
        for f in funcs:
            for h_ in heads:
                titles.add((h_.format(f=f), f))
        for title, key in sorted(titles):
            split = split_of(key)
            for v in range(2):  # two option menus per title
                t = title if v == 0 else rng.choice([title.lower(), title.upper() if len(title) < 6 else title, title.replace(" of ", ", ")])
                crit, gold_key = subset(rng, T.DEPARTMENTS, dept)
                out.add(row(dep["version"], "authored:en", {"job_title": t}, {"department": dep["question"](crit)},
                            {"department": {"probabilities": {k: float(k == gold_key) for k in crit}}}, split, f"auth-title-{dept}-{n}"), t + "|" + str(v))
                n += 1
    return n
