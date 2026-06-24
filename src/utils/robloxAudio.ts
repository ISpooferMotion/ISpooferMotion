import { convertFileSrc, invoke } from '@tauri-apps/api/core';

import { AppConfig } from '../contexts/ConfigContext';
import { logIsm } from './robloxProfiles';

let currentAudio: HTMLAudioElement | null = null;
let playbackToken = 0;

const notifyPlaybackChange = (assetId: string | null) => {
  window.dispatchEvent(new CustomEvent('ism-audio-playback-change', { detail: { assetId } }));
};

export const stopRobloxAudio = () => {
  playbackToken++;
  if (!currentAudio) return;

  currentAudio.pause();
  currentAudio.currentTime = 0;
  currentAudio = null;
  notifyPlaybackChange(null);
};

// handles playing audio previews through the tauri backend to bypass cors and auth issues
export const playRobloxAudio = async (assetId: string, config: AppConfig) => {
  if (!assetId.trim()) {
    logIsm('warn', 'No Roblox audio asset id was provided.');
    return false;
  }

  stopRobloxAudio();
  const currentToken = ++playbackToken;

  try {
    const audioPath = await invoke<string>('play_roblox_audio', {
      assetId,
      cookie: config.spoofing.cookie || null,
      enableCache: config.debug.enableCache,
    });

    if (currentToken !== playbackToken) {
      return false;
    }

    const audioUrl = convertFileSrc(audioPath);
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    // hook up event listeners so the UI knows when to show the play/pause button
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
    if (currentToken !== playbackToken) {
      audio.pause();
      return false;
    }

    notifyPlaybackChange(assetId);
    logIsm('success', `Playing Roblox audio ${assetId}.`);
    return true;
  } catch (err) {
    if (currentToken === playbackToken) {
      stopRobloxAudio();
    }
    logIsm('error', `Could not play Roblox audio ${assetId}: ${String(err)}`);
    return false;
  }
};
