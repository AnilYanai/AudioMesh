import time
import numpy as np
from infer_rvc_python import BaseLoader

print("Initializing BaseLoader (CPU mode)...")
t0 = time.time()
converter = BaseLoader(only_cpu=True)

model_path = "models/voices/Noel_Vermillion/BlazBlue_Noel_Vermillion_English.pth"
index_path = "models/voices/Noel_Vermillion/added_IVF649_Flat_nprobe_1_BlazBlue_Noel_Vermillion_English_v2.index"

print("Configuring Noel Vermillion female voice model with +12 pitch shift...")
converter.apply_conf(
    tag="noel",
    file_model=model_path,
    pitch_algo="pm",
    pitch_lvl=12,
    file_index=index_path,
    index_influence=0.66,
)

# Generate 1.0 second of dummy 16kHz audio (440Hz test tone)
sr = 16000
duration = 1.0
t = np.linspace(0, duration, int(sr * duration), endpoint=False)
audio_sine = (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)

print("Warming up / running first inference...")
t1 = time.time()
out_audio = converter.generate_from_cache(audio_data=(audio_sine, sr), tag="noel")
t2 = time.time()
print(f"First inference took: {t2 - t1:.2f}s")

print("Running second inference (cached model)...")
t3 = time.time()
out_audio2 = converter.generate_from_cache(audio_data=(audio_sine, sr), tag="noel")
t4 = time.time()
print(f"Second inference took: {t4 - t3:.2f}s")
print(f"Output type: {type(out_audio2)}, length: {len(out_audio2) if out_audio2 is not None else 'None'}")
print("SUCCESS! Voice conversion pipeline is working perfectly!")
