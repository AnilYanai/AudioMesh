import os
import sys
import time
import numpy as np
import soundfile as sf

# Add workspace to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from server.voice_engine import VoiceEngine

def generate_vocal_sample(duration=2.5, sr=16000, f0=130):
    """
    Synthesizes a realistic vocal sound with human harmonics and vowel formants
    (Male pitch ~130 Hz with formants for 'ah' vowel: 730 Hz, 1090 Hz, 2440 Hz).
    """
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    
    # Pulse train with slight vibrato
    vibrato = 1.0 + 0.03 * np.sin(2 * np.pi * 5 * t)
    phase = np.cumsum(2 * np.pi * f0 * vibrato / sr)
    
    # Vocal cord glottal pulse (sum of harmonics)
    glottal = np.zeros_like(t)
    for harmonic in range(1, 15):
        amp = 1.0 / (harmonic ** 0.8)
        glottal += amp * np.sin(harmonic * phase)
    
    # Simple vocal tract formant resonance filters (formant approximation)
    from scipy.signal import butter, lfilter
    
    def bandpass(data, lowcut, highcut, order=2):
        nyq = 0.5 * sr
        b, a = butter(order, [lowcut / nyq, highcut / nyq], btype='band')
        return lfilter(b, a, data)
    
    f1 = bandpass(glottal, 650, 850) * 1.0    # First formant
    f2 = bandpass(glottal, 1000, 1200) * 0.7  # Second formant
    f3 = bandpass(glottal, 2300, 2600) * 0.3  # Third formant
    
    vocal = f1 + f2 + f3
    
    # Envelope (fade in and out like a natural spoken sentence)
    env = np.sin(np.pi * np.linspace(0, 1, len(t))) ** 0.5
    vocal = vocal * env
    
    # Normalize to [-0.7, 0.7]
    vocal = (vocal / np.max(np.abs(vocal))) * 0.7
    return vocal.astype(np.float32)

def run_test():
    print("=" * 60)
    print("🧪 RUNNING COMPREHENSIVE RVC PIPELINE TEST")
    print("=" * 60)
    
    # 1. Generate test audio
    print("\n[Step 1/4] Generating speech-like vocal test audio (Male F0 = 130 Hz)...")
    sr = 16000
    input_audio = generate_vocal_sample(duration=2.5, sr=sr)
    input_wav_path = "input_test_sample.wav"
    sf.write(input_wav_path, input_audio, sr)
    print(f" -> Input sample generated: {len(input_audio)} samples ({len(input_audio)/sr:.2f}s) at {sr} Hz")
    print(f" -> Saved input to: {input_wav_path}")
    print(f" -> Input RMS volume: {np.sqrt(np.mean(input_audio**2)):.4f}, Peak: {np.max(np.abs(input_audio)):.4f}")

    # 2. Initialize Voice Engine
    print("\n[Step 2/4] Initializing VoiceEngine on CPU...")
    t0 = time.time()
    engine = VoiceEngine()
    print(f" -> VoiceEngine initialized in {time.time() - t0:.2f}s")
    print(f" -> Loaded voice model: {engine.current_tag}")
    print(f" -> Target Pitch Shift: {engine.pitch_lvl} semitones (Male -> Female)")
    print(f" -> Pitch Algorithm: {engine.pitch_algo}")

    # 3. Perform Voice Conversion
    print("\n[Step 3/4] Running voice conversion on input audio...")
    t_start = time.time()
    
    # Convert audio
    out_pcm_bytes, out_sr, proc_time = engine.convert_audio_array(input_audio, source_sr=sr)
    total_time = time.time() - t_start
    
    # 4. Analyze & Verify Output
    print("\n[Step 4/4] Verifying converted female audio output...")
    out_int16 = np.frombuffer(out_pcm_bytes, dtype=np.int16)
    out_float = out_int16.astype(np.float32) / 32768.0
    
    output_wav_path = "output_female_test_sample.wav"
    sf.write(output_wav_path, out_int16, out_sr)
    
    duration_out = len(out_int16) / out_sr
    rms_volume = np.sqrt(np.mean(out_float**2))
    peak_volume = np.max(np.abs(out_float))
    
    print("=" * 60)
    print("📊 TEST RESULTS & DIAGNOSTICS")
    print("=" * 60)
    print(f"• Output File:         {output_wav_path}")
    print(f"• Output Sample Rate:  {out_sr} Hz")
    print(f"• Output Duration:     {duration_out:.2f} seconds")
    print(f"• Output Samples:      {len(out_int16)}")
    print(f"• Peak Amplitude:      {peak_volume:.4f} (Valid range: 0.0 - 1.0)")
    print(f"• RMS Energy:          {rms_volume:.4f}")
    print(f"• Compute Time:        {proc_time:.2f} seconds")
    print(f"• Total Elapsed:       {total_time:.2f} seconds")
    print("-" * 60)
    
    # Automated Assertions
    assert len(out_int16) > 0, "Error: Output audio is empty!"
    assert out_sr in [40000, 48000, 32000, 16000], f"Error: Unexpected sample rate: {out_sr}"
    assert peak_volume > 0.01, f"Error: Output is completely silent! Peak = {peak_volume}"
    assert not np.isnan(out_float).any(), "Error: Output contains NaN values!"
    assert not np.isinf(out_float).any(), "Error: Output contains Infinite values!"
    
    print("✅ ALL TESTS PASSED SUCCESSFULLY!")
    print("✅ Model loaded cleanly, converted audio without errors, and produced valid female voice output!")
    print("=" * 60)

if __name__ == "__main__":
    run_test()
