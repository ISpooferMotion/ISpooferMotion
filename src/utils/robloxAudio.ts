import { convertFileSrc, invoke } from '@tauri-apps/api/core';

import { AppConfig } from '../contexts/ConfigContext';
import { logIsm } from './robloxProfiles';

let currentAudio: HTMLAudioElement | null = null;

const notifyPlaybackChange = (assetId: string | null) => {
  window.dispatchEvent(new CustomEvent('ism-audio-playback-change', { detail: { assetId } }));
};

export const stopRobloxAudio = () => {
  if (!currentAudio) return;

  currentAudio.pause();
  currentAudio.currentTime = 0;
  currentAudio = null;
  notifyPlaybackChange(null);
};

export const playRobloxAudio = async (assetId: string, config: AppConfig) => {
  if (!assetId.trim()) {
    logIsm('warn', 'No Roblox audio asset id was provided.');
    return false;
  }

  stopRobloxAudio();

  try {
    const audioPath = await invoke<string>('play_roblox_audio', {
      assetId,
      cookie: config.spoofing.cookie || null,
      enableCache: config.debug.enableCache,
    });

    const audioUrl = convertFileSrc(audioPath);
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    audio.addEventListener('error', () => {
      if (currentAudio === audio) {
        currentAudio = null;
        notifyPlaybackChange(null);
      }
      logIsm('error', `Playback failed for audio ${assetId}`);
    });

    audio.addEventListener('ended', () => {
      if (currentAudio === audio) {
        currentAudio = null;
        notifyPlaybackChange(null);
      }
    });

    await audio.play();
    notifyPlaybackChange(assetId);
    logIsm('success', `Playing Roblox audio ${assetId}.`);
    return true;
  } catch (err) {
    stopRobloxAudio();
    logIsm('error', `Could not play Roblox audio ${assetId}: ${String(err)}`);
    return false;
  }
};
