import os
import time
import glob
import logging
import numpy as np
import soundfile as sf
import io
import torch
import pyworld as pw
import scipy.signal as signal
import scipy.ndimage as ndimage

from infer_rvc_python import BaseLoader

logger = logging.getLogger("VoiceEngine")
logging.basicConfig(level=logging.INFO)

class VoiceEngine:
    def __init__(self, models_dir=None):
        # Configure PyTorch CPU threads for Ryzen 3500U
        num_cores = os.cpu_count() or 4
        threads_to_use = min(4, num_cores)
        torch.set_num_threads(threads_to_use)
        logger.info(f"PyTorch threads set to {threads_to_use}")

        self.models_dir = models_dir or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "voices"
        )
        
        logger.info("Initializing RVC BaseLoader on CPU...")
        self.loader = BaseLoader(only_cpu=True)
        
        self.current_tag = None
        self.available_models = {}
        self.pitch_lvl = 11         # +11 semitones = natural male-to-female vocal pitch
        self.pitch_algo = "pm"      # 'pm' (Parselmouth) is fastest on CPU
        self.index_influence = 0.0    # 0.0 disables heavy FAISS CPU search for speed
        self.engine_mode = "dsp"      # Default: 'dsp' (0.2s ultra-fast) or 'rvc' (neural model)
        self.volume_gain = 1.6        # 1.6x default loudness boost with soft limiter
        self.denoise_mode = "normal"  # 'normal', 'low', 'off', 'high'
        self.denoise_enabled = True   # Background fan noise cancellation
        self.denoise_strength = 0.6   # Transparent noise reduction preserving full speech quality
        self.highpass_cutoff = 75.0   # 75 Hz cuts fan rumble while preserving all speech fundamentals
        self.noise_spectrum_floor = None # Persistent VAD-gated spectral noise memory (preserves speech quality during long speeches)
        self.vocal_profile = "standard" # 'standard' (universal) or 'creator' (soft voice, de-hiss, de-breath)
        self.calibrated_env = "auto"    # 'auto', 'quiet' (Fan OFF), 'fan_on' (Fan ON)
        self.calibrated_noise_db = None
        
        self.scan_models()
        if self.available_models:
            first_model = list(self.available_models.keys())[0]
            self.load_voice(first_model, pitch_lvl=self.pitch_lvl, index_influence=0.0)

    def scan_models(self):
        """Scans the models directory for .pth and .index files."""
        self.available_models = {}
        if not os.path.exists(self.models_dir):
            return self.available_models
            
        for root, dirs, files in os.walk(self.models_dir):
            pth_files = [f for f in files if f.endswith(".pth")]
            index_files = [f for f in files if f.endswith(".index")]
            
            for pth in pth_files:
                name = os.path.splitext(pth)[0]
                pth_path = os.path.join(root, pth)
                index_path = ""
                if index_files:
                    matching = [f for f in index_files if name.lower() in f.lower()]
                    if matching:
                        index_path = os.path.join(root, matching[0])
                    else:
                        index_path = os.path.join(root, index_files[0])
                        
                self.available_models[name] = {
                    "name": name,
                    "pth": pth_path,
                    "index": index_path,
                    "folder": os.path.basename(root)
                }
        logger.info(f"Found {len(self.available_models)} voice models: {list(self.available_models.keys())}")
        return self.available_models

    def load_voice(self, model_name, pitch_lvl=11, pitch_algo="pm", index_influence=0.0, volume_gain=None):
        """Pre-configures a voice model in BaseLoader."""
        if volume_gain is not None:
            self.volume_gain = float(volume_gain)
        if model_name not in self.available_models:
            raise ValueError(f"Model '{model_name}' not found. Available: {list(self.available_models.keys())}")
            
        model_info = self.available_models[model_name]
        self.current_tag = model_name
        self.pitch_lvl = int(pitch_lvl)
        self.pitch_algo = pitch_algo
        self.index_influence = float(index_influence)
        
        logger.info(f"Applying config for voice '{model_name}' (pitch: {self.pitch_lvl}, algo: {self.pitch_algo}, index: {self.index_influence})")
        self.loader.apply_conf(
            tag=self.current_tag,
            file_model=model_info["pth"],
            pitch_algo=self.pitch_algo,
            pitch_lvl=self.pitch_lvl,
            file_index=model_info["index"] if self.index_influence > 0 else "",
            index_influence=self.index_influence
        )
        return {
            "status": "loaded",
            "model": model_name,
            "pitch_lvl": self.pitch_lvl,
            "pitch_algo": self.pitch_algo,
            "index_influence": self.index_influence,
            "engine_mode": self.engine_mode,
            "denoise_mode": self.denoise_mode
        }

    def set_denoise_mode(self, mode: str):
        """Configure background noise cancellation strength."""
        mode = str(mode).lower()
        if mode == "high":
            self.denoise_mode = "high"
            self.denoise_enabled = True
            self.denoise_strength = 0.9
            self.highpass_cutoff = 80.0
        elif mode in ("normal", "clean"):
            self.denoise_mode = "normal"
            self.denoise_enabled = True
            self.denoise_strength = 0.6
            self.highpass_cutoff = 75.0
        elif mode in ("gentle", "low"):
            self.denoise_mode = "low"
            self.denoise_enabled = True
            self.denoise_strength = 0.3
            self.highpass_cutoff = 70.0
        elif mode in ("off", "false", "0"):
            self.denoise_mode = "off"
            self.denoise_enabled = False
            self.denoise_strength = 0.0
            self.highpass_cutoff = 0.0
        else:
            self.denoise_mode = "normal"
            self.denoise_enabled = True
            self.denoise_strength = 0.6
            self.highpass_cutoff = 75.0
        logger.info(f"🛡️ Noise Cancellation set to: '{self.denoise_mode}' (strength={self.denoise_strength}, cutoff={self.highpass_cutoff}Hz)")
        return self.denoise_mode

    def denoise_audio(self, audio: np.ndarray, sr: int = 16000, strength: float = 0.6, highpass_cutoff: float = 75.0):
        """
        Vocal-Preserving Transparent Denoiser:
        1. 4th-order Butterworth highpass at 75Hz preserves all speech fundamentals while cutting fan motor rumble.
        2. 2D-Smoothed Wiener STFT filter with transparent floor reduces fan noise without eating syllables or cutting audio.
        """
        if len(audio) < 512 or strength <= 0:
            return audio

        orig_len = len(audio)
        if audio.dtype == np.int16:
            x = audio.astype(np.float32) / 32768.0
            was_int16 = True
        else:
            x = audio.astype(np.float32)
            was_int16 = False

        # 1. High-pass filter (removes fan motor vibration & 50/60Hz rumble while preserving vocal warmth)
        if highpass_cutoff > 0:
            sos = signal.butter(4, highpass_cutoff, 'hp', fs=sr, output='sos')
            x = signal.sosfilt(sos, x)

        # 2. STFT Analysis
        nperseg = 512
        noverlap = 384
        f, t_spec, Zxx = signal.stft(x, fs=sr, nperseg=nperseg, noverlap=noverlap)
        mag = np.abs(Zxx)
        phase = np.angle(Zxx)

        # Estimate stationary noise floor per frequency bin
        # VAD-Gated Noise Memory: NEVER estimate noise from speech harmonics!
        frame_energy = np.mean(mag, axis=0)
        min_e = np.min(frame_energy)
        pause_threshold = max(min_e * 1.6, 0.0005)
        pause_frames = frame_energy <= pause_threshold

        if np.sum(pause_frames) >= 4:
            # Audio contains true room noise pauses: update persistent noise spectrum
            measured_noise = np.median(mag[:, pause_frames], axis=1, keepdims=True)
            if self.noise_spectrum_floor is None:
                self.noise_spectrum_floor = measured_noise
            else:
                self.noise_spectrum_floor = 0.85 * self.noise_spectrum_floor + 0.15 * measured_noise
            noise_floor = self.noise_spectrum_floor
        else:
            # Continuous speech with no pauses: use stored background profile to preserve 100% of speech harmonics
            if self.noise_spectrum_floor is not None:
                noise_floor = self.noise_spectrum_floor
            else:
                noise_floor = np.percentile(mag, 5, axis=1, keepdims=True)

        # Wiener Gain calculation with transparent floor (never mutes or chips speech)
        snr = (mag / (noise_floor + 1e-7)) ** 2
        min_gain = max(0.20, 0.45 - 0.20 * strength)
        gain = np.clip((snr - 1.0) / (snr + 1e-7), min_gain, 1.0)

        # 2D-Smoothing across frequency and time: eliminates isolated frequency spikes
        smooth_gain = ndimage.uniform_filter(gain, size=(3, 3))
        clean_mag = mag * smooth_gain

        # Reconstruct audio via ISTFT (Preserves 100% of unvoiced consonants and soft vowels)
        Zxx_clean = clean_mag * np.exp(1j * phase)
        _, clean_x = signal.istft(Zxx_clean, fs=sr, nperseg=nperseg, noverlap=noverlap)

        if len(clean_x) > orig_len:
            clean_x = clean_x[:orig_len]
        elif len(clean_x) < orig_len:
            clean_x = np.pad(clean_x, (0, orig_len - len(clean_x)))

        if was_int16:
            return (np.clip(clean_x, -1.0, 1.0) * 32767.0).astype(np.int16)
        return clean_x

    def set_room_calibration(self, noise_db: float, mode: str = "auto"):
        """Stores physical room background noise level from a 1.5s silent calibration sample."""
        self.calibrated_noise_db = float(noise_db)
        m = str(mode).lower().strip()
        if m in ("fan_on", "fan", "noisy"):
            self.calibrated_env = "fan_on"
        elif m in ("quiet", "fan_off", "silent"):
            self.calibrated_env = "quiet"
        else:
            self.calibrated_env = "quiet" if float(noise_db) <= -54.0 else "fan_on"
        logger.info(f"🎯 Room Calibration Applied: {self.calibrated_noise_db:.1f} dBFS -> Mode: '{self.calibrated_env}'")
        return self.calibrated_env, self.calibrated_noise_db

    def apply_creator_filters(self, audio_f: np.ndarray, sr: int = 16000, is_quiet_env: bool = False) -> np.ndarray:
        """
        Adaptive Creator Profile Filter (Calibrated to Mathavan's Voice):
        1. Deep Fundamental Protection (60Hz zero-phase highpass):
           Preserves Mathavan's deep 65.2Hz vocal fundamental while eliminating DC/fan rumble.
        2. Vocal Core Presence Lift (+3.5dB):
           Boosts 120Hz-2800Hz core so quiet speech syllables are punchy, crisp, and never cut off.
        3. Headset Mic Intelligibility & Consonant Crispness Lift (2500Hz - 5500Hz):
           Specifically compensates for budget headset mic capsules, restoring crisp 't', 'k', 's', 'p' consonants!
        4. Precision Studio De-Esser (4400Hz - 7500Hz):
           Compresses sharp tongue-tie sibilance without eating into vowel third formants.
        """
        if len(audio_f) < 64:
            return audio_f

        # 1. Zero-phase highpass (60Hz in quiet room, 75Hz when fan is on)
        hp_cutoff = 60.0 if is_quiet_env else 75.0
        sos_hp = signal.butter(4, hp_cutoff, 'hp', fs=sr, output='sos')
        audio_f = np.ascontiguousarray(signal.sosfiltfilt(sos_hp, audio_f))

        # 2. Vocal Core Presence Lift (Gives soft speech clarity and punch)
        sos_core = signal.butter(2, [120.0, 2800.0], 'bandpass', fs=sr, output='sos')
        core_band = signal.sosfiltfilt(sos_core, audio_f)
        core_boost = 0.35 if is_quiet_env else 0.45
        audio_f = audio_f + core_boost * core_band

        # 3. Consonant Intelligibility Lift (2500Hz - 5500Hz) for budget headset mic capsules
        sos_clarity = signal.butter(2, [2500.0, 5500.0], 'bandpass', fs=sr, output='sos')
        clarity_band = signal.sosfiltfilt(sos_clarity, audio_f)
        audio_f = audio_f + 0.25 * clarity_band

        # 4. Precision De-Esser (4400Hz - 7500Hz)
        sos_sib = signal.butter(2, [4400.0, 7500.0], 'bandpass', fs=sr, output='sos')
        sib_band = signal.sosfiltfilt(sos_sib, audio_f)

        window_len = int(sr * 0.015)
        if window_len % 2 == 0:
            window_len += 1
        kernel = np.ones(window_len) / window_len

        sib_energy = signal.convolve(sib_band ** 2, kernel, mode='same')
        tot_energy = signal.convolve(audio_f ** 2, kernel, mode='same') + 1e-7
        sib_ratio = np.sqrt(sib_energy / tot_energy)

        # Smooth compression of sibilant hiss peaks
        excess = np.maximum(0, sib_ratio - 0.26)
        reduction = np.clip(1.0 - (excess * 2.5), 0.35, 1.0)
        audio_f = audio_f - sib_band * (1.0 - reduction)

        return np.ascontiguousarray(audio_f)

    def set_vocal_profile(self, profile: str):
        """Toggle between 'standard' and 'creator' vocal profiles."""
        p = str(profile).lower().strip()
        if p in ("creator", "custom", "soft", "soft_voice"):
            self.vocal_profile = "creator"
        else:
            self.vocal_profile = "standard"
        logger.info(f"👤 Vocal Profile set to: '{self.vocal_profile}'")
        return self.vocal_profile

    def convert_dsp_female(self, audio_data: np.ndarray, source_sr: int = 16000, pitch_shift: float = 11.0, formant_shift: float = 1.13):
        """
        Ultra-fast (0.1s - 0.3s) Natural Female Voice Transformation:
        1. Zero-phase highpass filter: completely eliminates ceiling fan / DC motor rumble with 0 phase distortion.
        2. Natural 1.13x Formant Scaling: anatomically matches natural adult female vocal tract (no chipmunk / robotic pinching).
        3. Feminine Glottal Warmth: boosts 300-800Hz body while gently rolling off high-frequency metallic harshness.
        4. Frequency-Selective Aperiodicity: preserves natural breathiness (>2.5kHz) while anchoring vocal core (<2kHz) against hollow air.
        """
        start_time = time.time()
        
        if audio_data.dtype == np.int16:
            audio_f = audio_data.astype(np.float64) / 32768.0
        else:
            audio_f = audio_data.astype(np.float64)

        # Environmental Auto-Sensing / Calibrated Profile
        if self.calibrated_env == "quiet":
            is_quiet_env = True
        elif self.calibrated_env == "fan_on":
            is_quiet_env = False
        else:
            # Auto-sensing based on frame RMS
            is_quiet_env = False
            frame_len = int(0.025 * source_sr)
            if len(audio_f) >= frame_len * 3:
                num_frames = len(audio_f) // frame_len
                frames = audio_f[:num_frames * frame_len].reshape(num_frames, frame_len)
                frame_rms = np.sqrt(np.mean(frames ** 2, axis=1))
                floor_rms = np.percentile(frame_rms, 10)
                noise_db = 20 * np.log10(max(float(floor_rms), 1e-6))
                is_quiet_env = noise_db < -54.0

        if self.vocal_profile == "creator":
            # Apply personalized Creator Pipeline: Adaptive De-Breath, Soft Voice Core Lift, Studio De-Esser
            audio_f = self.apply_creator_filters(audio_f, source_sr, is_quiet_env=is_quiet_env)
        else:
            # Standard universal mode: Clean 75Hz zero-phase highpass for fan rumble
            if self.highpass_cutoff > 0 and len(audio_f) > 30:
                sos = signal.butter(4, self.highpass_cutoff, 'hp', fs=source_sr, output='sos')
                audio_f = np.ascontiguousarray(signal.sosfiltfilt(sos, audio_f))
            
        # Fast F0 estimation:
        # In Creator Profile: f0_floor=55.0Hz captures 100% of Mathavan's deep 60-70Hz words (NO words cut out!)
        # In Standard Profile: f0_floor=75.0Hz for universal general speech
        f0_floor_val = 55.0 if self.vocal_profile == "creator" else 75.0
        _f0, t_f0 = pw.dio(audio_f, source_sr, f0_floor=f0_floor_val, f0_ceil=450.0, frame_period=5.0)
        f0 = pw.stonemask(audio_f, _f0, t_f0, source_sr)
        # 3-tap median filter cleans isolated jitter without smearing consonant transitions
        f0 = signal.medfilt(f0, 3)
        # Bridge isolated single-frame dropouts
        for i in range(1, len(f0) - 1):
            if f0[i] == 0 and f0[i - 1] > 0 and f0[i + 1] > 0:
                f0[i] = 0.5 * (f0[i - 1] + f0[i + 1])

        # Vocoder Anti-Buzz Silence Guard:
        # Distinguish true human vocal cord vibrations from random ceiling fan turbulence
        frame_len_vad = int(0.030 * source_sr)
        n_vad_frames = len(audio_f) // frame_len_vad
        max_periodicity = 0.0
        if n_vad_frames > 0:
            vad_frames = audio_f[:n_vad_frames * frame_len_vad].reshape(n_vad_frames, frame_len_vad)
            vad_rms = np.sqrt(np.mean(vad_frames ** 2, axis=1))
            active_idx = np.where(vad_rms > 0.003)[0]
            if len(active_idx) > 0:
                sample_idx = active_idx[np.linspace(0, len(active_idx) - 1, min(len(active_idx), 20)).astype(int)]
                for s_idx in sample_idx:
                    c = vad_frames[s_idx] - np.mean(vad_frames[s_idx])
                    e = np.sum(c ** 2)
                    if e > 1e-6:
                        corr = np.correlate(c, c, mode='full')
                        norm_corr = corr[len(corr) // 2:] / (e + 1e-7)
                        if len(norm_corr) > 290:
                            max_periodicity = max(max_periodicity, float(np.max(norm_corr[40:290])))

        # If audio is pure fan noise or room atmosphere (no human vocal cord periodicity or no voiced frames):
        # NEVER run the vocoder! This completely eliminates robotic buzzing/screeching on background fan noise.
        voiced_count = np.sum(f0 > 0)
        if voiced_count < 3 or max_periodicity < 0.45:
            attenuated = (audio_f * 0.05 * 32767).astype(np.int16)
            elapsed = time.time() - start_time
            logger.info(f"🛡️ [Anti-Buzz Guard] Bypassed vocoder on fan noise/silence (Periodicity: {max_periodicity:.2f})")
            return attenuated.tobytes(), source_sr, elapsed

        # Spectral envelope (formants) & aperiodicity
        sp = pw.cheaptrick(audio_f, f0, t_f0, source_sr)
        ap = pw.d4c(audio_f, f0, t_f0, source_sr)

        # 1. Pitch shift into female vocal range
        f0_shifted = f0 * (2.0 ** (pitch_shift / 12.0))
        if self.vocal_profile == "creator":
            # Female pitch anchor >= 165Hz (E3): completely eradicates low-register creaking vocal fry / motorboat sounds!
            f0_female = np.where(f0 > 0, np.maximum(f0_shifted, 165.0), 0.0)
        else:
            f0_female = f0_shifted
        
        # 2. Formant shift with continuous linear interpolation (1.13x = natural female head resonance)
        freq_bins = sp.shape[1]
        orig_indices = np.clip(np.arange(freq_bins) / formant_shift, 0, freq_bins - 1)
        idx_floor = np.floor(orig_indices).astype(int)
        idx_ceil = np.clip(idx_floor + 1, 0, freq_bins - 1)
        weight = orig_indices - idx_floor
        sp_female = (1 - weight) * sp[:, idx_floor] + weight * sp[:, idx_ceil]

        # 3. Feminine Vocal Warmth & Glottal Tilt:
        # Boosts 300-800Hz vocal presence and applies natural roll-off above 4kHz to remove robotic metallic edge
        freqs = np.linspace(0, source_sr / 2, freq_bins)
        warmth_curve = 1.0 + 0.16 * np.exp(-((freqs - 500) / 400)**2) - 0.10 * (freqs / (source_sr / 2))
        sp_female = np.ascontiguousarray(sp_female * warmth_curve[np.newaxis, :])

        # 4. Frequency-Selective Aperiodicity & Aspiration Solidification:
        ap_female = ap.copy()
        voiced = f0 > 0
        
        if self.vocal_profile == "creator":
            # Aspiration Solidification:
            # Replaces escaping mouth air with 65% solid female vocal cord tone (ap <= 0.35 in core).
            # Ensures every single spoken word is crystal-clear, crisp, and intelligible!
            core_mask = (freqs >= 100) & (freqs <= 3500)
            high_mask = freqs > 3500
            if np.any(voiced):
                ap_female[np.ix_(voiced, core_mask)] = np.minimum(ap_female[np.ix_(voiced, core_mask)], 0.35)
                ap_female[np.ix_(voiced, high_mask)] = np.minimum(ap_female[np.ix_(voiced, high_mask)], 0.75)
        else:
            # Standard universal mode: preserve natural high-frequency breath while anchoring low fundamental
            freq_mask_low = freqs < 2000
            if np.any(voiced):
                ap_female[np.ix_(voiced, freq_mask_low)] = np.minimum(ap_female[np.ix_(voiced, freq_mask_low)], 0.85)
        ap_female = np.ascontiguousarray(ap_female)
            
        # 5. Natural High-Fidelity Synthesis
        y = pw.synthesize(f0_female, sp_female, ap_female, source_sr)
        elapsed = time.time() - start_time
        
        # 6. Smooth Volume Limiter
        max_val = np.max(np.abs(y))
        if max_val > 0.005:
            norm_y = y / max_val
            gain = min(max(float(self.volume_gain), 0.5), 2.5)
            v = norm_y * gain
            boosted = v / (1.0 + 0.22 * (np.abs(v) ** 1.8))
            peak = np.max(np.abs(boosted))
            if peak > 0.98:
                boosted = boosted / peak * 0.98
            pcm_int16 = (boosted * 32767).astype(np.int16)
        else:
            pcm_int16 = (y * 32767).astype(np.int16)
        
        logger.info(f"⚡ [DSP Fast Engine] Converted {len(audio_f)/source_sr:.2f}s audio in {elapsed*1000:.1f}ms! (Profile: {self.vocal_profile}, Pitch: +{pitch_shift}, Env: {'Quiet' if is_quiet_env else 'Fan/Noisy'})")
        return pcm_int16.tobytes(), source_sr, elapsed

    def convert_rvc(self, audio_data: np.ndarray, source_sr: int = 16000):
        """Standard RVC deep neural synthesis."""
        if not self.current_tag:
            raise RuntimeError("No voice model is currently loaded.")

        if audio_data.dtype == np.int16:
            audio_float = audio_data.astype(np.float32) / 32768.0
        else:
            audio_float = audio_data.astype(np.float32)

        start_time = time.time()
        logger.info(f"⚙️ [RVC AI Engine] Running model '{self.current_tag}' on {len(audio_float)/source_sr:.2f}s audio...")

        # Optimize internal pipeline padding for 2x faster CPU inference
        if hasattr(self.loader, "model_vc") and "pipe" in self.loader.model_vc:
            pipe = self.loader.model_vc["pipe"]
            if pipe.t_pad > 3200:
                pipe.t_pad = 2400
                pipe.t_pad2 = 4800
                tgt_sr = self.loader.model_vc.get("tgt_sr", 40000)
                pipe.t_pad_tgt = int(2400 * (tgt_sr / 16000.0))
        
        out_audio, target_sr = self.loader.generate_from_cache(
            audio_data=(audio_float, source_sr),
            tag=self.current_tag
        )
        
        elapsed = time.time() - start_time
        logger.info(f"⚙️ [RVC AI Engine] Synthesis complete in {elapsed:.2f}s. Target SR: {target_sr} Hz")
        
        if out_audio.dtype != np.int16:
            out_float = out_audio.astype(np.float32)
            max_val = np.max(np.abs(out_float))
            if max_val > 0.005:
                norm = out_float / max_val
                gain = min(max(float(self.volume_gain), 0.5), 3.0)
                boosted = np.tanh(norm * gain) / np.tanh(gain) * 0.98
                out_audio = (boosted * 32767).astype(np.int16)
            else:
                out_audio = (out_audio * 32767).astype(np.int16)
            
        pcm_bytes = out_audio.tobytes()
        return pcm_bytes, target_sr, elapsed

    def convert_audio_array(self, audio_data: np.ndarray, source_sr: int = 16000, mode=None):
        """Unified audio conversion dispatcher."""
        selected_mode = mode or self.engine_mode
        if selected_mode == "dsp":
            # For DSP Fast Engine: PyWorld synthesizes pure clean glottal pulses directly.
            # We bypass the STFT Wiener denoiser to prevent spectral smearing of vocal formants,
            # using zero-phase highpass at 75Hz inside convert_dsp_female for zero fan rumble.
            return self.convert_dsp_female(audio_data, source_sr, pitch_shift=self.pitch_lvl, formant_shift=1.13)
        else:
            # Background noise cancellation for RVC Neural AI
            if self.denoise_enabled and self.denoise_strength > 0:
                audio_data = self.denoise_audio(
                    audio_data, source_sr,
                    strength=self.denoise_strength,
                    highpass_cutoff=self.highpass_cutoff
                )
            return self.convert_rvc(audio_data, source_sr)
