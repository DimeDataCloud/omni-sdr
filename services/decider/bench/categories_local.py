# reply_triage@3 category bench on this machine (no cloud, $0): python categories_local.py <rows.jsonl> <questions.json> <out.jsonl>
# Each row: {id, subject?, body}. Writes {id, answers: {q: noul}} per row. Same predict() the decider's /v1/systemone runs.
import json, sys, time
from laya import Router
rows_path, q_path, out_path = sys.argv[1:4]
questions = json.load(open(q_path, encoding='utf-8'))
router = Router(default='english')
rows = [json.loads(l) for l in open(rows_path, encoding='utf-8') if l.strip()]
done = set()
try:
    done = {json.loads(l)['id'] for l in open(out_path, encoding='utf-8') if l.strip()}
except FileNotFoundError:
    pass
t0 = time.time()
with open(out_path, 'a', encoding='utf-8', newline='\n') as out:
    for i, r in enumerate(rows):
        if r['id'] in done: continue
        state = {'subject': (r.get('subject') or '')[:998], 'body': r['body'][:8000]}
        res = router.predict(state, questions, model='english')
        ans = {k: v.get('noul') for k, v in res['answers'].items()}
        out.write(json.dumps({'id': r['id'], 'answers': ans}) + '\n'); out.flush()
        if i % 10 == 0: print(f'{i+1}/{len(rows)} {time.time()-t0:.0f}s', flush=True)
print('done', len(rows), f'{time.time()-t0:.0f}s')
