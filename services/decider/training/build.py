"""Turn the raw public datasets (fetch.py) into laya training rows for the tasks in tasks.py.

    python services/decider/training/build.py [--data DIR] [--seed 7]

Writes DIR/build/<task>/{train,test}.jsonl in the format laya's fine-tuning script reads (the vendor's
LocalLLaMA/typed-decisions layout): one row per state, with `state`, `questions` and `gold` as JSON strings and
gold given as probabilities per option. Also DIR/build/STATS.json: rows per task, split, source and label.

Mapping rules (every label below comes from the source dataset's own intent or code, never from a model):
- An intent whose meaning is ambiguous for a task is DROPPED rather than forced into a label. Wrong labels cost more
  precision than missing rows cost recall.
- Splits follow the source's own test split where it has one, otherwise a stable hash of the text (10% test).
- Text is deduplicated per task after lowercasing and collapsing whitespace.
"""
import argparse, collections, hashlib, json, os, random, re

import pandas as pd

import tasks as T
from authored import replies as A

# ─── IVR routing ──────────────────────────────────────────────────────────────────────────────────────────────
BANKING77 = {
    "billing": ["Refund_not_showing_up", "card_payment_fee_charged", "card_payment_not_recognised",
                "card_payment_wrong_exchange_rate", "cash_withdrawal_charge", "cash_withdrawal_not_recognised",
                "direct_debit_payment_not_recognised", "exchange_charge", "extra_charge_on_statement", "pending_card_payment",
                "request_refund", "reverted_card_payment?", "top_up_by_bank_transfer_charge", "top_up_by_card_charge",
                "transaction_charged_twice", "transfer_fee_charged", "wrong_amount_of_cash_received",
                "wrong_exchange_rate_for_cash_withdrawal", "balance_not_updated_after_bank_transfer",
                "balance_not_updated_after_cheque_or_cash_deposit"],
    "account": ["edit_personal_details", "passcode_forgotten", "pin_blocked", "change_pin", "unable_to_verify_identity",
                "verify_my_identity", "why_verify_identity", "verify_source_of_funds", "lost_or_stolen_phone"],
    "cancel": ["terminate_account"],
    "support": ["card_arrival", "card_not_working", "declined_card_payment", "declined_cash_withdrawal", "declined_transfer",
                "failed_transfer", "pending_transfer", "pending_cash_withdrawal", "pending_top_up", "top_up_failed",
                "top_up_reverted", "compromised_card", "lost_or_stolen_card", "atm_support", "contactless_not_working",
                "card_swallowed", "virtual_card_not_working", "transfer_not_received_by_recipient", "card_linking",
                "activate_my_card", "card_about_to_expire", "beneficiary_not_allowed", "cancel_transfer", "verify_top_up",
                "transfer_timing", "card_delivery_estimate", "receiving_money", "transfer_into_account", "top_up_limits",
                "disposable_card_limits", "automatic_top_up", "topping_up_by_card", "top_up_by_cash_or_cheque",
                "exchange_via_app"],
    # Dropped as ambiguous (product questions a menu could route to sales or support): age_limit, country_support,
    # exchange_rate, fiat_currency_support, supported_cards_and_currencies, visa_or_mastercard,
    # apple_pay_or_google_pay, card_acceptance, get_physical_card, order_physical_card, getting_spare_card,
    # getting_virtual_card, get_disposable_virtual_card.
}
BITEXT = {
    "cancel_order": "cancel", "delete_account": "cancel",
    "change_order": "support", "complaint": "support", "delivery_options": "support", "delivery_period": "support",
    "track_order": "support", "contact_customer_service": "support", "contact_human_agent": "support",
    "check_cancellation_fee": "billing", "check_invoice": "billing", "check_payment_methods": "billing",
    "check_refund_policy": "billing", "get_invoice": "billing", "get_refund": "billing", "payment_issue": "billing",
    "track_refund": "billing",
    "change_shipping_address": "account", "edit_account": "account", "recover_password": "account",
    "registration_problems": "account", "set_up_shipping_address": "account", "switch_account": "account",
    "create_account": "sales", "place_order": "sales",
    # Dropped: newsletter_subscription (subscribe and unsubscribe mixed), review.
}
BITEXT_HUMAN = {"contact_human_agent", "contact_customer_service"}
CLINC_IVR = {
    "billing": ["bill_balance", "bill_due", "pay_bill", "min_payment", "international_fees", "apr", "interest_rate", "transactions",
                "spending_history", "credit_limit"],
    "account": ["pin_change", "user_name", "change_user_name", "freeze_account", "account_blocked"],
    "support": ["card_declined", "damaged_card", "report_lost_card", "report_fraud", "replacement_card_duration",
                "order_status", "direct_deposit", "expiration_date", "application_status", "redeem_rewards",
                "rewards_balance", "credit_limit_change", "new_card", "order_checks"],
    "scheduling": ["schedule_meeting", "schedule_maintenance", "restaurant_reservation", "cancel_reservation",
                   "confirm_reservation", "book_hotel", "book_flight", "car_rental"],
    "sales": ["insurance_change"],
}
# Clearly not for a business's phone line: small talk and assistant chatter. Route to `other`.
CLINC_OTHER_DOMAINS = {"greeting", "goodbye", "thank_you", "tell_joke", "fun_fact", "meaning_of_life", "what_are_your_hobbies",
                       "how_old_are_you", "where_are_you_from", "what_is_your_name", "who_made_you", "who_do_you_work_for",
                       "do_you_have_pets", "are_you_a_bot", "weather", "flip_coin", "roll_dice", "calculator", "spelling",
                       "definition", "translate", "play_music", "next_song", "what_song", "change_volume", "whisper_mode",
                       "recipe", "cook_time", "calories", "nutrition_info", "ingredients_list", "ingredient_substitution",
                       "food_last", "meal_suggestion", "timer", "time", "date", "timezone", "measurement_conversion",
                       "plug_type", "traffic", "directions", "distance", "uber", "gas", "gas_type", "mpg", "tire_pressure",
                       "jump_start", "oil_change_how", "shopping_list", "shopping_list_update", "todo_list",
                       "todo_list_update", "smart_home", "share_location", "current_location", "find_phone", "make_call",
                       "text", "sync_device", "change_accent", "change_ai_name", "change_language", "change_speed",
                       "reset_settings", "repeat", "travel_suggestion", "restaurant_suggestion", "restaurant_reviews",
                       "next_holiday", "vaccines", "what_can_i_ask_you"}

# ─── Booking ──────────────────────────────────────────────────────────────────────────────────────────────────
MASSIVE_BOOKING = {"calendar_set": "book", "calendar_remove": "cancel", "calendar_query": "availability"}
CLINC_BOOKING = {"schedule_meeting": "book", "restaurant_reservation": "book", "book_flight": "book", "book_hotel": "book",
                 "car_rental": "book", "schedule_maintenance": "book", "cancel_reservation": "cancel",
                 "meeting_schedule": "availability", "confirm_reservation": "availability", "accept_reservations": "availability"}
SNIPS_BOOKING = {"BookRestaurant": "book"}
# A calendar_set utterance that moves an existing event is a reschedule, not a booking; the source doesn't say
# which, so those are dropped instead of guessed.
RESCHEDULE_WORDS = re.compile(r"\b(move|moved|reschedule|push|postpone|shift|change)\b", re.I)

# MInDS-14 (2026-10-02): spoken banking intents. Dropped as ambiguous for a department menu: abroad, atm_limit,
# balance, cash_deposit, high_value_payment.
MINDS14 = {1: "account", 2: "support", 5: "sales", 6: "support", 8: "billing", 9: "account", 11: "sales", 12: "billing", 13: "billing"}

# Taskmaster-1 (2026-10-02). Labels come from the dialog's own task and annotations, through these fixed rules:
# - book: the caller's first turn in a restaurant-table or auto-repair dialog, when it asks for a booking;
# - confirm: a caller turn the source annotates as accepting a reservation/appointment time or date, that is short,
#   follows an assistant question, and says yes in words (an annotated acceptance that only names a time is dropped);
# - none: the first turn of a pizza or coffee order (ordering, not booking).
TM_BOOK_TASKS = ("restaurant-table", "auto-repair")
TM_BOOK_WORDS = re.compile(r"\b(book|reserv|appointment|appt|schedule|table for|set up|get (me|us) in|make a)", re.I)
TM_CONFIRM_ANN = re.compile(r"(restaurant_reservation\.time\.reservation|auto_repair\.(time|date)\.appt)\.accept$")
TM_ASK = re.compile(r"\?|\b(can|could|would) you\b|\barrange\b|\bas soon as\b|\bgoodbye\b", re.I)  # a new ask, or a sign-off
TM_YES = re.compile(r"\b(yes|yeah|yep|sure|ok|okay|sounds (good|great|perfect)|works|perfect|great|fine|let'?s do|book it|that'?s good)\b", re.I)

# ─── ICP: job title -> department (O*NET-SOC) ─────────────────────────────────────────────────────────────────
SOC_EXACT = {
    "11-1011": "executive", "11-1021": "operations", "11-1031": "other",
    "11-2011": "marketing", "11-2021": "marketing", "11-2022": "sales", "11-2032": "marketing", "11-2033": "marketing",
    "11-3012": "admin", "11-3013": "operations", "11-3021": "it_engineering", "11-3031": "finance", "11-3051": "operations",
    "11-3061": "finance", "11-3071": "operations", "11-3111": "hr", "11-3121": "hr", "11-3131": "hr",
    "11-9021": "trades", "11-9041": "it_engineering", "11-9111": "operations",
    "13-1071": "hr", "13-1075": "hr", "13-1141": "hr", "13-1151": "hr", "13-1161": "marketing", "13-1081": "operations",
    "13-1020": "finance", "13-1021": "finance", "13-1022": "finance", "13-1023": "finance",
    "27-3031": "marketing", "27-1024": "marketing", "27-3043": "marketing",
    "43-4051": "admin",
}
SOC_MAJOR = {"15": "it_engineering", "17": "it_engineering", "29": "clinical", "31": "clinical", "41": "sales", "43": "admin",
             "47": "trades", "49": "trades", "51": "trades", "53": "operations"}
SOC_MINOR = {"13-2": "finance", "43-3": "finance"}


def soc_department(code):
    base = code.split(".")[0]
    if base in SOC_EXACT:
        return SOC_EXACT[base]
    for prefix, dept in SOC_MINOR.items():
        if base.startswith(prefix):
            return dept
    major = base[:2]
    if major == "11":
        return None  # other managers: function unclear from the code, dropped
    return SOC_MAJOR.get(major, "other")


# ─── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
norm = lambda s: re.sub(r"\s+", " ", str(s).strip().lower())
def hsplit(text):
    return "test" if int(hashlib.sha256(norm(text).encode()).hexdigest(), 16) % 10 == 0 else "train"


def row(task, source, state, questions, gold, split, rid):
    return {"id": rid, "task": task, "source": source, "split": split,
            "state": json.dumps(state, ensure_ascii=False), "questions": json.dumps(questions, ensure_ascii=False),
            "gold": json.dumps(gold)}


def onehot(options, chosen):
    return {"probabilities": {k: (1.0 if k == chosen else 0.0) for k in options}}


def noul(p):
    return {"probabilities": {"true": float(p), "false": 1.0 - float(p)}}


def subset(rng, full, correct, k_min=4, k_max=T.MAX_OPTIONS, p_absent=0.15):
    """A random option list of 4..10 that includes `other`; usually includes `correct`, sometimes not (then the
    right answer is `other`). Returns (criteria, gold_key)."""
    keys = [k for k in full if k != "other" and k != correct]
    k = rng.randint(k_min, k_max) - 1  # leave room for `other`
    absent = correct != "other" and rng.random() < p_absent
    picked = rng.sample(keys, min(len(keys), k - (0 if absent or correct == "other" else 1)))
    if not absent and correct != "other":
        picked.append(correct)
    rng.shuffle(picked)
    criteria = {key: full[key] for key in picked}
    criteria["other"] = full.get("other", "none of these")
    return criteria, ("other" if absent else correct)


class Out:
    def __init__(self, root):
        self.root, self.rows, self.seen = root, collections.defaultdict(list), collections.defaultdict(set)

    def add(self, r, text):
        key = norm(text)
        if key in self.seen[r["task"]]:
            return
        self.seen[r["task"]].add(key)
        self.rows[r["task"]].append(r)

    def write(self):
        stats = {}
        for task, rows in self.rows.items():
            d = os.path.join(self.root, task)
            os.makedirs(d, exist_ok=True)
            st = {"rows": len(rows), "by_split": collections.Counter(r["split"] for r in rows),
                  "by_source": collections.Counter(r["source"] for r in rows), "by_label": collections.Counter()}
            for split in ("train", "test"):
                with open(os.path.join(d, f"{split}.jsonl"), "w", encoding="utf-8", newline="\n") as f:
                    for r in rows:
                        if r["split"] == split:
                            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            for r in rows:
                for qid, g in json.loads(r["gold"]).items():
                    probs = g["probabilities"]
                    st["by_label"][f"{qid}={max(probs, key=probs.get)}"] += 1
            stats[task] = {k: dict(v) if isinstance(v, collections.Counter) else v for k, v in st.items()}
        with open(os.path.join(self.root, "STATS.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(stats, f, indent=1, sort_keys=True)
        return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(os.path.expanduser("~"), "omni-sdr-training"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--cap", type=int, default=600, help="max rows per label per source for the big ICP sources")
    ap.add_argument("--langs", default="", help="extra MASSIVE locales for booking@1, e.g. es-ES,fr-FR (multilingual checkpoint)")
    ap.add_argument("--no-authored", action="store_true", help="leave out the authored rows (authored/)")
    args = ap.parse_args()
    raw, out = os.path.join(args.data, "raw"), Out(os.path.join(args.data, "build"))
    rng = random.Random(args.seed)

    # IVR routing
    ivr = T.IVR_ROUTE
    def ivr_row(source, text, dept, human, split, rid):
        crit, gold_key = subset(rng, T.IVR_DEPARTMENTS, dept, k_min=4, k_max=7)
        q = {"department": {**ivr["questions"]["department"], "criteria": crit}, "human": ivr["questions"]["human"]}
        g = {"department": onehot(crit, gold_key), "human": noul(1.0 if human else 0.0)}
        out.add(row(ivr["version"], source, {"transcript": text}, q, g, split, rid), text)

    b77 = {i: d for d, intents in BANKING77.items() for i in intents}
    for split in ("train", "test"):
        for i, r in pd.read_csv(os.path.join(raw, "banking77", f"{split}.csv")).iterrows():
            if r.category in b77:
                ivr_row("banking77", r.text, b77[r.category], False, split, f"b77-{split}-{i}")
    bt = pd.read_parquet(os.path.join(raw, "bitext", "train.parquet"))
    for i, r in bt.iterrows():
        if r.intent in BITEXT:
            text = re.sub(r"\{\{[^}]+\}\}", lambda m: rng.choice(["12345", "my order", "my account", "it"]), r.instruction)
            ivr_row("bitext", text, BITEXT[r.intent], r.intent in BITEXT_HUMAN, hsplit(text), f"bitext-{i}")
    clinc = json.load(open(os.path.join(raw, "clinc150", "data_full.json"), encoding="utf-8"))
    c_ivr = {i: d for d, intents in CLINC_IVR.items() for i in intents}
    other_budget = collections.Counter()
    for part, split in (("train", "train"), ("val", "train"), ("test", "test"), ("oos_train", "train"), ("oos_val", "train"), ("oos_test", "test")):
        for j, (text, intent) in enumerate(clinc[part]):
            dept = "other" if intent == "oos" or intent in CLINC_OTHER_DOMAINS else c_ivr.get(intent)
            if dept == "other":
                # Small talk would otherwise be a third of all IVR rows and teach "other" as the safe guess.
                if other_budget[intent] >= 60:
                    continue
                other_budget[intent] += 1
            if dept:
                ivr_row("clinc150", text, dept, False, split, f"clinc-{part}-{j}")

    # Booking
    bk = T.BOOKING
    def booking_row(source, text, action, split, rid):
        g = {"action": onehot(bk["questions"]["action"]["criteria"], action),
             "wants_time": noul(1.0 if action in ("book", "reschedule", "confirm") else 0.0)}
        out.add(row(bk["version"], source, {"body": text}, bk["questions"], g, split, rid), text)

    none_budget = collections.Counter()
    en_kept_book = set()
    with open(os.path.join(raw, "massive", "1.1", "data", "en-US.jsonl"), encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            split = "test" if r["partition"] == "test" else "train"
            action = MASSIVE_BOOKING.get(r["intent"])
            if action == "book" and RESCHEDULE_WORDS.search(r["utt"]):
                continue
            if action == "book":
                en_kept_book.add(r["id"])
            if action is None:
                if none_budget[r["intent"]] >= 40:
                    continue
                none_budget[r["intent"]] += 1
                action = "none"
            booking_row("massive", r["utt"], action, split, f"massive-{r['id']}")
    for part, split in (("train", "train"), ("val", "train"), ("test", "test"), ("oos_train", "train"), ("oos_test", "test")):
        for j, (text, intent) in enumerate(clinc[part]):
            action = CLINC_BOOKING.get(intent)
            if action is None:
                if none_budget["clinc:" + intent] >= 15:
                    continue
                none_budget["clinc:" + intent] += 1
                action = "none"
            booking_row("clinc150", text, action, split, f"clinc-bk-{part}-{j}")
    for split in ("train", "test"):
        for i, r in pd.read_parquet(os.path.join(raw, "snips", f"{split}.parquet")).iterrows():
            action = SNIPS_BOOKING.get(r.category)
            if action is None:
                if none_budget["snips:" + r.category] >= 150:
                    continue
                none_budget["snips:" + r.category] += 1
                action = "none"
            booking_row("snips", r.text, action, split, f"snips-{split}-{i}")

    # ICP: industry from NAICS index entries (one row per entry, capped per sector)
    ind = T.ICP_INDUSTRY
    sectors = {}
    for code, name in T.NAICS_SECTORS.items():
        sectors.setdefault(name, []).append(code)
    full = {name: name for name in sectors}
    full["other"] = "none of these"
    per_sector = collections.Counter()
    naics = pd.read_excel(os.path.join(raw, "naics", "2022_NAICS_Index_File.xlsx")).sample(frac=1.0, random_state=args.seed)
    for i, r in naics.iterrows():
        code = str(r.NAICS22)[:2]
        name = T.NAICS_SECTORS.get(code)
        desc = str(r["INDEX ITEM DESCRIPTION"]).strip()
        if not name or not desc or desc.lower() == "nan" or per_sector[name] >= args.cap:
            continue
        per_sector[name] += 1
        crit, gold_key = subset(rng, full, name)
        out.add(row(ind["version"], "naics", {"business": desc}, {"industry": ind["question"](crit)},
                    {"industry": onehot(crit, gold_key)}, hsplit(desc), f"naics-{i}"), desc)

    # ICP: department from O*NET job titles (capped per department)
    dep = T.ICP_DEPARTMENT
    per_dept = collections.Counter()
    titles = pd.read_csv(os.path.join(raw, "onet", "db_31_0_text", "Job Titles.txt"), sep="\t").sample(frac=1.0, random_state=args.seed)
    for i, r in titles.iterrows():
        d = soc_department(r["O*NET-SOC Code"])
        title = str(r["Job Title"]).strip()
        if not d or per_dept[d] >= args.cap * 3:
            continue
        per_dept[d] += 1
        crit, gold_key = subset(rng, T.DEPARTMENTS, d)
        out.add(row(dep["version"], "onet", {"job_title": title}, {"department": dep["question"](crit)},
                    {"department": onehot(crit, gold_key)}, hsplit(title), f"onet-{i}"), title)

    # ── Added 2026-10-02 ──────────────────────────────────────────────────────────────────────────────────────
    # IVR: MInDS-14 spoken transcripts (English locales). Each locale's own rows; split by text hash.
    for loc in ("en-US", "en-GB", "en-AU"):
        p = os.path.join(raw, "minds14", f"{loc}.parquet")
        if not os.path.exists(p):
            continue
        for i, r in pd.read_parquet(p).iterrows():
            dept = MINDS14.get(int(r.intent_class))
            text = str(r.transcription).strip()
            if dept and text:
                ivr_row("minds14", text, dept, False, hsplit(text), f"minds14-{loc}-{i}")

    # Booking (+ IVR scheduling): Taskmaster-1, crowd-written and WOZ dialogs.
    tm_none, tm_book = collections.Counter(), collections.Counter()
    for fname in ("self-dialogs.json", "woz-dialogs.json"):
        p = os.path.join(raw, "taskmaster", fname)
        if not os.path.exists(p):
            continue
        for dlg in json.load(open(p, encoding="utf-8")):
            task, utts = dlg["instruction_id"], dlg["utterances"]
            split = "test" if int(hashlib.sha256(dlg["conversation_id"].encode()).hexdigest(), 16) % 10 == 0 else "train"
            first_user = next((u for u in utts if u["speaker"] == "USER"), None)
            if first_user and task.startswith(TM_BOOK_TASKS) and TM_BOOK_WORDS.search(first_user["text"]) and tm_book[task.split("-")[0]] < 600:
                # Capped: every auto-repair dialog names the same two shops, which a model would learn as "book".
                tm_book[task.split("-")[0]] += 1
                booking_row("taskmaster1", first_user["text"], "book", split, f"tm1-book-{dlg['conversation_id']}")
                ivr_row("taskmaster1", first_user["text"], "scheduling", False, split, f"tm1-ivr-{dlg['conversation_id']}")
            elif first_user and task.startswith(("pizza", "coffee")) and tm_none[task.split("-")[0]] < 300:
                tm_none[task.split("-")[0]] += 1
                booking_row("taskmaster1", first_user["text"], "none", split, f"tm1-none-{dlg['conversation_id']}")
            for k, u in enumerate(utts):
                if u["speaker"] != "USER" or k == 0 or utts[k - 1]["speaker"] != "ASSISTANT" or not utts[k - 1]["text"].rstrip().endswith("?"):
                    continue
                names = [a["name"] for s_ in u.get("segments", []) for a in s_["annotations"]]
                if any(TM_CONFIRM_ANN.search(n) for n in names) and len(u["text"].split()) <= 14 and TM_YES.search(u["text"]) and not TM_ASK.search(u["text"]):
                    booking_row("taskmaster1", u["text"], "confirm", split, f"tm1-confirm-{dlg['conversation_id']}-{k}")

    # ICP department: O*NET's sample of titles workers actually report ("CEO", "HR Generalist"), same SOC mapping.
    rep = os.path.join(raw, "onet", "db_31_0_text", "Sample of Reported Titles.txt")
    for i, r in pd.read_csv(rep, sep="\t").iterrows():
        d = soc_department(r["O*NET-SOC Code"])
        title = str(r["Reported Job Title"]).strip()
        if d:
            crit, gold_key = subset(rng, T.DEPARTMENTS, d)
            out.add(row(dep["version"], "onet_reported", {"job_title": title}, {"department": dep["question"](crit)},
                        {"department": onehot(crit, gold_key)}, hsplit(title), f"onet-rep-{i}"), title)

    # Authored (authored/cores.py): reply triage, booking reschedule/confirm, IVR "ask for a person". Own RNGs.
    if not args.no_authored:
        print("authored offered:", {"reply_triage": A.add_reply_triage(out, row), "booking": A.add_booking(out, row),
                                    "ivr_human": A.add_ivr_human(out, row, subset), "titles": A.add_titles(out, row, subset)})

    # Booking in other languages (MASSIVE 1.1, same intent mapping) for the multilingual checkpoint (L9).
    for loc in filter(None, args.langs.split(",")):
        with open(os.path.join(raw, "massive", "1.1", "data", f"{loc}.jsonl"), encoding="utf-8") as f:
            ml_none = collections.Counter()
            for line in f:
                r = json.loads(line)
                action = MASSIVE_BOOKING.get(r["intent"])
                if action is None:
                    if ml_none[r["intent"]] >= 40:
                        continue
                    ml_none[r["intent"]] += 1
                    action = "none"
                elif action == "book":
                    # The reschedule filter is English-only, so other locales keep calendar_set out of `book`
                    # unless its parallel English utterance (same id in en-US) was kept.
                    if r["id"] not in en_kept_book:
                        continue
                booking_row(f"massive:{loc}", r["utt"], action, "test" if r["partition"] == "test" else "train", f"massive-{loc}-{r['id']}")

    # Replay: the vendor's own typed decisions, so specialising doesn't erase the base skills.
    for split in ("train", "test"):
        for _, r in pd.read_parquet(os.path.join(raw, "typed_decisions", f"{split}.parquet")).iterrows():
            out.add({"id": r.id, "task": "replay@vendor", "source": "typed_decisions", "split": split,
                     "state": r.state, "questions": r.questions, "gold": r.gold}, r.state)

    stats = out.write()
    for task, st in stats.items():
        print(f"{task:18} rows={st['rows']:>6}  train={st['by_split'].get('train', 0):>6}  test={st['by_split'].get('test', 0):>5}  sources={st['by_source']}")


if __name__ == "__main__":
    main()
