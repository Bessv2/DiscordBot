import { VoiceState } from 'discord.js';
import { handleTempVoice } from '../features/tempVoice';
import { logVoiceChange } from '../serverlog/handlers';

export async function voiceStateUpdate(before: VoiceState, after: VoiceState): Promise<void> {
  await handleTempVoice(before, after);
  await logVoiceChange(before, after);
}
