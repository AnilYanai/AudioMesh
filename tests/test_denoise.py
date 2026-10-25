import numpy as np
import scipy.signal as signal
import time

def denoise_audio(audio: np.ndarray, sr: int = 16000, strength: float = 1.0, highpass_cutoff: float = 80.0):
    """
    Dual-stage vocal noise suppressor for fan hum, room rumble, and stationary background noise.
    1. 4th-order Butterworth high-pass filter cuts sub-bass room rumble & fan motor hum (< 80 Hz).
    2. Fast STFT spectral subtraction suppresses steady-state fan airflow & white noise.
    """
    if len(audio) < 512:
        return audio
        
    t_start = time.time()
    orig_len = len(audio)
    
    # Ensure float32 in [-1.0, 1.0]
    if audio.dtype == np.int16:
        x = audio.astype(np.float32) / 32768.0
        was_int16 = True
    else:
        x = audio.astype(np.float32)
        was_int16 = False
        
    # 1. High-pass filter (removes fan motor, 50/60Hz mains, and low-frequency rumble)
    if highpass_cutoff > 0:
        sos = signal.butter(4, highpass_cutoff, 'hp', fs=sr, output='sos')
        x = signal.sosfilt(sos, x)
        
    # 2. Fast STFT Spectral Subtraction
    nperseg = 512
    noverlap = 384
    f, t_spec, Zxx = signal.stft(x, fs=sr, nperseg=nperseg, noverlap=noverlap)
    mag = np.abs(Zxx)
    phase = np.angle(Zxx)
    
    # Estimate noise floor per frequency bin using 15th percentile
    noise_floor = np.percentile(mag, 15, axis=1, keepdims=True)
    
    # Oversubtraction factor alpha and floor beta
    alpha = 1.8 * strength
    beta = 0.04
    
    # Clean spectral magnitude
    clean_mag = np.maximum(mag - alpha * noise_floor, beta * mag)
    
    # 3. Soft Noise Gate on quiet frames
    frame_rms = np.sqrt(np.mean(clean_mag ** 2, axis=0, keepdims=True))
    gate_thresh = np.percentile(frame_rms, 25) * 1.2
    mask = np.clip((frame_rms - gate_thresh * 0.5) / (gate_thresh * 0.5 + 1e-6), 0.05, 1.0)
    clean_mag = clean_mag * mask
    
    # Reconstruct audio via ISTFT
    Zxx_clean = clean_mag * np.exp(1j * phase)
    _, clean_x = signal.istft(Zxx_clean, fs=sr, nperseg=nperseg, noverlap=noverlap)
    
    # Truncate or pad to match original length
    if len(clean_x) > orig_len:
        clean_x = clean_x[:orig_len]
    elif len(clean_x) < orig_len:
        clean_x = np.pad(clean_x, (0, orig_len - len(clean_x)))
        
    elapsed = time.time() - t_start
    print(f"Denoise finished in {elapsed*1000:.2f}ms for {orig_len/sr:.2f}s audio.")
    
    if was_int16:
        return (np.clip(clean_x, -1.0, 1.0) * 32767.0).astype(np.int16)
    return clean_x

if __name__ == "__main__":
    sr = 16000
    dur = 2.0
    t = np.linspace(0, dur, int(sr * dur))
    
    # Vowels + fan hum + noise
    speech = 0.4 * np.sin(2 * np.pi * 220 * t) * (np.sin(2 * np.pi * 1.5 * t) > 0.2)
    fan_hum = 0.2 * np.sin(2 * np.pi * 60 * t) + 0.1 * np.sin(2 * np.pi * 120 * t)
    air_noise = 0.08 * np.random.randn(len(t))
    noisy = speech + fan_hum + air_noise
    
    print(f"Original noisy RMS: {np.sqrt(np.mean(noisy**2)):.4f}")
    clean = denoise_audio(noisy, sr=sr, strength=1.0)
    print(f"Cleaned signal RMS: {np.sqrt(np.mean(clean**2)):.4f}")
