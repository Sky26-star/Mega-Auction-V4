// src/lib/supabase/broadcast.ts

import { getEnv } from '../env';

export interface BroadcastOptions {
  roomId: string;
  event: string;
  payload: Record<string, unknown>;
  sequence?: number;
}

export async function broadcastToRoom({ roomId, event, payload, sequence }: BroadcastOptions): Promise<boolean> {
  const env = getEnv();
  if (!env.supabaseServiceRoleKey) {
    console.warn('SUPABASE_SERVICE_ROLE_KEY is missing. Realtime REST Broadcast skipped.');
    return false;
  }

  const url = `${env.supabaseUrl}/realtime/v1/broadcast`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: `room:${roomId}`,
        event,
        payload: {
          sequence: sequence ?? 0,
          event_type: event,
          payload,
        },
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Realtime REST Broadcast failed:', error);
    return false;
  }
}
