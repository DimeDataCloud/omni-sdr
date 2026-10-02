"""Download the public datasets the decider is fine-tuned on (SOURCES.md lists each one's license).

    python services/decider/training/fetch.py [--data DIR]

Files land in DIR/raw/<source>/ (default ~/omni-sdr-training, outside the Drive-synced Halo folder and outside
git). Every download is recorded in DIR/raw/MANIFEST.json with its URL, byte size and sha256, so a training run
can name exactly what it learned from. Re-running skips files that are already present with the same hash.
"""
import argparse, hashlib, io, json, os, tarfile, urllib.request, zipfile

HF = "https://huggingface.co/api/datasets/{repo}/parquet/{config}/{split}/0.parquet"
SOURCES = {
    # IVR routing / support intents
    "banking77": [("train.csv", "https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/master/banking_data/train.csv"),
                  ("test.csv", "https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/master/banking_data/test.csv")],
    # The original release: the HF parquet carries intent ids without names.
    "clinc150": [("data_full.json", "https://raw.githubusercontent.com/clinc/oos-eval/master/data/data_full.json")],
    "bitext": [("train.parquet", HF.format(repo="bitext/Bitext-customer-support-llm-chatbot-training-dataset", config="default", split="train"))],
    # Booking / scheduling intents
    "massive": [("amazon-massive-dataset-1.1.tar.gz", "https://amazon-massive-nlu-dataset.s3.amazonaws.com/amazon-massive-dataset-1.1.tar.gz")],
    "snips": [(f"{s}.parquet", HF.format(repo="benayas/snips", config="default", split=s)) for s in ("train", "test")],
    # The vendor's own typed decisions (keeps the base skills while we specialise)
    "typed_decisions": [(f"{s}.parquet", HF.format(repo="LocalLLaMA/typed-decisions", config="all", split=s)) for s in ("train", "test")],
    # ICP: job titles -> occupation (O*NET 31.0, CC BY 4.0) and business descriptions -> industry (NAICS, public domain)
    "onet": [("db_31_0_text.zip", "https://www.onetcenter.org/dl_files/database/db_31_0_text.zip")],
    "naics": [("2022_NAICS_Index_File.xlsx", "https://www.census.gov/naics/2022NAICS/2022_NAICS_Index_File.xlsx"),
              ("2022_NAICS_Descriptions.xlsx", "https://www.census.gov/naics/2022NAICS/2022_NAICS_Descriptions.xlsx")],
}
UA = {"User-Agent": "omni-sdr-training/1.0 (dimedatateam@gmail.com)"}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(os.path.expanduser("~"), "omni-sdr-training"))
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    raw = os.path.join(args.data, "raw")
    os.makedirs(raw, exist_ok=True)
    manifest_path = os.path.join(raw, "MANIFEST.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    only = set(filter(None, args.only.split(",")))
    for source, files in SOURCES.items():
        if only and source not in only:
            continue
        os.makedirs(os.path.join(raw, source), exist_ok=True)
        for name, url in files:
            path = os.path.join(raw, source, name)
            key = f"{source}/{name}"
            if os.path.exists(path) and manifest.get(key, {}).get("sha256") == sha256(path):
                print(f"have  {key}")
                continue
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            manifest[key] = {"url": url, "bytes": len(data), "sha256": sha256(path)}
            print(f"got   {key}  {len(data) / 1e6:.1f} MB")
            if name.endswith(".tar.gz"):
                with tarfile.open(path) as t:
                    t.extractall(os.path.join(raw, source), filter="data")
            elif name.endswith(".zip"):
                with zipfile.ZipFile(path) as z:
                    z.extractall(os.path.join(raw, source))
    tmp = manifest_path + ".part"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    os.replace(tmp, manifest_path)


if __name__ == "__main__":
    main()
