"""Remove every transformers model family laya does not load, so a cold start indexes 2 packages, not 500+.

transformers builds its lazy-import index by walking transformers/models/ on first use; on Cloud Run that walk
was most of a 41 s cold start. laya's english checkpoint needs `auto` (AutoTokenizer/AutoConfig/AutoModel) and
`modernbert`; transformers 5.18 also imports `encoder_decoder` from tokenization_auto and six tokenizer families
from integrations/gguf at load time. The list is for transformers==5.18.0 (pinned in the Dockerfile). The build's smoke test (smoke.py) loads and runs the model afterwards, so a prune that removed
something needed fails the build instead of the first request.
"""
import os, shutil, transformers

KEEP = {"auto", "modernbert", "encoder_decoder", "gemma", "gpt2", "llama", "qwen2", "qwen3_5", "t5", "__pycache__"}
models = os.path.join(os.path.dirname(transformers.__file__), "models")
removed = 0
for name in os.listdir(models):
    path = os.path.join(models, name)
    if os.path.isdir(path) and name not in KEEP:
        shutil.rmtree(path)
        removed += 1
print(f"pruned {removed} model packages; kept {sorted(KEEP - {'__pycache__'})}")
