export type VoiceState = 'idle' | 'connecting' | 'live' | 'ending' | 'error';

export interface Caption {
  id: string;
  role: 'user' | 'agent';
  text: string;
}

export interface VoiceToolCall {
  name: string;
  arguments: string;
  callId: string;
}

export interface VoiceOptions {
  /** The hotel; may be empty only for a guest session with scope 'global'. */
  propertyId: string | undefined;
  audience: 'guest' | 'staff';
  /** Guests: 'hotel' (default) talks to that hotel's front desk; 'global' to the HotelOne concierge across all hotels. */
  scope?: 'hotel' | 'global';
  /** Run a tool the voice asked for and return its JSON-serialisable output. */
  onToolCall: (call: VoiceToolCall, ctx: { token: string }) => Promise<unknown>;
  onStateChange?: (s: VoiceState) => void;
  /**
   * Fetch the provider's SDK ahead of the first tap (default true). The guest
   * site's dock passes false until someone shows intent (hover, focus, touch),
   * so pages nobody talks on don't download it.
   */
  preload?: boolean;
}

/** What every voice provider hook returns; components only use this. */
export interface VoiceController {
  state: VoiceState;
  error: string | null;
  captions: Caption[];
  muted: boolean;
  level: number;
  agentSpeaking: boolean;
  working: boolean;
  start: () => Promise<void>;
  stop: () => void;
  toggleMute: () => void;
  clearError: () => void;
  /** Tell the agent something it should know without replying (e.g. what page the guest is on). No-op when not live. */
  sendContext: (text: string) => void;
}

/** Most captions a session keeps for the transcript. */
export const MAX_CAPTIONS = 60;

/** The session endpoint's query string for these options. */
export function sessionQuery({ propertyId, audience, scope }: Pick<VoiceOptions, 'propertyId' | 'audience' | 'scope'>): string {
  const q = new URLSearchParams({ audience });
  if (audience === 'guest' && scope === 'global') q.set('scope', 'global');
  else if (propertyId) q.set('propertyId', propertyId);
  return q.toString();
}

/** Whether these options can start a session (a hotel, or a guest concierge session). */
export const canStart = ({ propertyId, audience, scope }: Pick<VoiceOptions, 'propertyId' | 'audience' | 'scope'>) => !!propertyId || (audience === 'guest' && scope === 'global');
