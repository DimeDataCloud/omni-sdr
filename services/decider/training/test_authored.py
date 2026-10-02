"""Invariants of the authored training rows and the golden sets. Standard library only:

    python -m unittest services/decider/training/test_authored.py   (from the repo root)
"""
import collections, json, os, re, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tasks as T  # noqa: E402
from authored import cores as C, replies as A  # noqa: E402


def row(task, source, state, questions, gold, split, rid):
    return {"id": rid, "task": task, "source": source, "split": split, "state": state, "questions": questions, "gold": gold}


class Collect:
    def __init__(self):
        self.rows = []

    def add(self, r, text):
        self.rows.append((r, text))


def subset(rng, full, correct, k_min=4, k_max=10):
    crit = dict(full)
    return crit, correct


class AuthoredReplies(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = Collect()
        A.add_reply_triage(cls.out, row, per_core=6, per_core_es=3)

    def test_stop_and_meet_follow_the_label(self):
        for r, _ in self.out.rows:
            g = r["gold"]
            label = max(g["label"]["probabilities"], key=g["label"]["probabilities"].get)
            self.assertEqual(g["stop"]["probabilities"]["true"] == 1.0, label == "unsubscribe", r["id"])
            self.assertEqual(g["meet"]["probabilities"]["true"] == 1.0, label == "meeting_request", r["id"])

    def test_questions_are_the_production_wording(self):
        for r, _ in self.out.rows[:50]:
            self.assertEqual(r["questions"], T.REPLY_TRIAGE["questions"])

    def test_a_core_is_never_in_both_splits(self):
        splits = collections.defaultdict(set)
        for r, _ in self.out.rows:
            splits[r["id"].rsplit("-", 1)[0]].add(r["split"])
        self.assertTrue(all(len(s) == 1 for s in splits.values()))
        self.assertGreater(sum(s == {"test"} for s in splits.values()), 20)

    def test_no_golden_body_is_trained_on(self):
        keys = A.golden_keys()
        self.assertGreater(len(keys), 100)
        for r, _ in self.out.rows:
            core_letters = re.sub(r"[^a-záéíóúñü]", "", r["state"]["body"].lower())
            self.assertNotIn(core_letters, keys - {""}, r["id"])

    def test_test_rows_use_only_held_out_wrappers(self):
        train_sigs = [s for i, s in enumerate(A.SIGNATURE) if i % 5 != 4]
        marker = lambda s: s.strip().split("\n")[-1][:25]
        for r, _ in self.out.rows:
            if r["split"] == "test":
                for s in train_sigs:
                    if "{" not in marker(s):
                        self.assertNotIn(marker(s), r["state"]["body"], r["id"])

    def test_quoted_pitch_never_changes_the_gold(self):
        quoted = [r for r, _ in self.out.rows if "+quote" in r["source"] and "STOP" in r["state"]["body"]]
        self.assertGreater(len(quoted), 10)
        self.assertTrue(any(r["gold"]["stop"]["probabilities"]["true"] == 0.0 for r in quoted))


class Golden(unittest.TestCase):
    def test_golden_sets_follow_the_conventions(self):
        for name in ("reply_triage.jsonl", "reply_triage_mail.jsonl"):
            rows = [json.loads(l) for l in open(os.path.join(HERE, "golden", name), encoding="utf-8")]
            self.assertEqual(len({r["id"] for r in rows}), len(rows))
            for r in rows:
                self.assertEqual(r["stop"], r["label"] == "unsubscribe", r["id"])
                self.assertIn(r["label"], T.REPLY_TRIAGE["questions"]["label"]["criteria"])


class AuthoredBookingAndTitles(unittest.TestCase):
    def test_wants_time_follows_the_action(self):
        out = Collect()
        A.add_booking(out, row, per_core=2)
        actions = collections.Counter()
        for r, _ in out.rows:
            a = max(r["gold"]["action"]["probabilities"], key=r["gold"]["action"]["probabilities"].get)
            actions[a] += 1
            self.assertEqual(r["gold"]["wants_time"]["probabilities"]["true"] == 1.0, a in ("book", "reschedule", "confirm"))
        self.assertGreater(actions["reschedule"], 0)
        self.assertGreater(actions["confirm"], 0)

    def test_titles_cover_the_thin_departments(self):
        out = Collect()
        A.add_titles(out, row, subset)
        depts = collections.Counter(max(r["gold"]["department"]["probabilities"], key=r["gold"]["department"]["probabilities"].get)
                                    for r, _ in out.rows)
        for d in ("executive", "marketing", "hr"):
            self.assertGreater(depts[d], 40, d)


if __name__ == "__main__":
    unittest.main()
