import { requireStaff } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { checkElevenLabs } from '@/server/voice/elevenlabs';
import { checkVoiceModels } from '@/server/voice/live';
import { voiceAvailable, voiceProvider } from '@/server/voice/provider';

export const dynamic = 'force-dynamic';

/**
 * GET — is the voice provider usable? ElevenLabs: the key works and both
 * agents exist and are in sync (this also creates them the first time).
 * OpenAI: the key can use the voice and reasoning models.
 */
export const GET = handleRoute(async () => {
  await requireStaff('voice.manage');
  const provider = voiceProvider();
  if (!voiceAvailable()) return json({ provider, key: false, models: [] });
  return json({ provider, key: true, models: provider === 'elevenlabs' ? await checkElevenLabs() : await checkVoiceModels() });
});
