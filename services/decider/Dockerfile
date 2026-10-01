# Laya decision service ("decider"). Internal only: Cloud Run with IAM auth, no public ingress.
# The checkpoint is baked into the image at a reviewed commit, so a cold start never reaches the Hub
# and the weights that answered a decision are the ones this image was built with.
FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 HF_HOME=/models
# CPU-only torch by default: the CUDA wheels add ~3 GB that every cold start pulls and never uses.
# A GPU build passes --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu130.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN pip install torch --index-url ${TORCH_INDEX} && pip install "laya[serve]==0.3.23" "transformers==5.18.0"

# convaiinnovations/laya at laya.PINNED_REVISIONS (0.3.23). Change both together.
ARG LAYA_SHA=55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851
RUN python -c "from huggingface_hub import snapshot_download as s; s('convaiinnovations/laya', revision='${LAYA_SHA}')"

# Cold start: drop the transformers model families laya never loads (prune.py says why).
COPY prune.py smoke.py /opt/decider/
RUN python /opt/decider/prune.py && python -m compileall -q /usr/local/lib/python3.12/site-packages/transformers

ENV HF_HUB_OFFLINE=1 \
    LAYA_REVISION=reviewed \
    LAYA_MODELS=english \
    LAYA_DEFAULT_MODEL=english \
    LAYA_MAX_LOADED=1 \
    LAYA_PRELOAD=1 \
    LAYA_PORT=8080

# Fails the build if the pruned image can't load the checkpoint offline or misreads an explicit opt-out.
RUN python /opt/decider/smoke.py

EXPOSE 8080
CMD ["laya-serve"]
