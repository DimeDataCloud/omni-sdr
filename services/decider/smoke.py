"""Build-time check: the pruned image loads the pinned checkpoint offline and answers a known case."""
import time
from laya import Router

t0 = time.time()
router = Router(preload=False)
router.preload(["english"])
loaded = time.time() - t0
r = router.predict({"subject": "Re: Omni", "body": "Please take me off your list."},
                   {"stop": {"type": "noul", "instructions": "Does the sender ask us to stop contacting them or remove them from a list?"}})
p = r["answers"]["stop"]["noul"]
print(f"smoke: load {loaded:.1f}s, stop={p:.2f}")
assert p >= 0.9, f"smoke: an explicit opt-out scored {p}"
