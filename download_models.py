import os
import sys
import zipfile
import urllib.request
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
VOICES_DIR = os.path.join(MODELS_DIR, "voices")

os.makedirs(VOICES_DIR, exist_ok=True)

MODELS = [
    {
        "name": "Noel_Vermillion",
        "url": "https://huggingface.co/Nick088/BlazBlue_Noel_Vermillion_English/resolve/main/BlazBlue_Noel_Vermillion_English.zip",
        "extract_to": os.path.join(VOICES_DIR, "Noel_Vermillion"),
    },
    {
        "name": "Furina",
        "url": "https://huggingface.co/makiligon/RVC-Models/resolve/main/Furina.zip",
        "extract_to": os.path.join(VOICES_DIR, "Furina"),
    }
]

def download_file(url, target_path):
    print(f"Downloading from {url} -> {target_path}...")
    headers = {"User-Agent": "Mozilla/5.0"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as response, open(target_path, 'wb') as out_file:
        total_size = int(response.info().get('Content-Length', 0))
        downloaded = 0
        block_size = 1024 * 1024  # 1MB
        while True:
            buffer = response.read(block_size)
            if not buffer:
                break
            downloaded += len(buffer)
            out_file.write(buffer)
            if total_size > 0:
                percent = downloaded * 100 / total_size
                print(f"\rProgress: {downloaded / (1024*1024):.1f} MB / {total_size / (1024*1024):.1f} MB ({percent:.1f}%)", end="", flush=True)
            else:
                print(f"\rDownloaded: {downloaded / (1024*1024):.1f} MB", end="", flush=True)
    print("\nDownload complete!")

def main():
    for item in MODELS:
        dest_dir = item["extract_to"]
        os.makedirs(dest_dir, exist_ok=True)
        zip_path = os.path.join(dest_dir, f"{item['name']}.zip")
        
        # Check if model already extracted
        pth_files = [f for f in os.listdir(dest_dir) if f.endswith(".pth")]
        if pth_files:
            print(f"Model {item['name']} already exists ({pth_files[0]}), skipping.")
            continue
            
        try:
            download_file(item["url"], zip_path)
            print(f"Extracting {zip_path} to {dest_dir}...")
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(dest_dir)
            if os.path.exists(zip_path):
                os.remove(zip_path)
            print(f"Model {item['name']} ready!")
        except Exception as e:
            print(f"Error downloading {item['name']}: {e}")

    # Now preload hubert model into cache
    print("\nPre-caching HuBERT base model from Hugging Face...")
    try:
        from transformers import HubertModel
        HubertModel.from_pretrained("r3gm/hubert_base")
        print("HuBERT base model successfully cached!")
    except Exception as e:
        print(f"Note on HuBERT cache: {e}")

if __name__ == "__main__":
    main()
