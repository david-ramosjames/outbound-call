import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from '../config.js';

export const supabase = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node < 22 has no global WebSocket; supabase-js realtime requires one at init
    realtime: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport: WebSocket as any,
    },
  }
);
