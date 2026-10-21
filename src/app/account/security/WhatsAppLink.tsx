'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { MessageCircle } from 'lucide-react';
import { api } from '@/lib/fetcher';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface WhatsAppStatus {
  available: boolean;
  staffNumber: string | null;
  linked: { number: string; linkedAt: string } | null;
}

interface Pending {
  code: string;
  expiresAt: string;
  staffNumber: string | null;
  chatUrl: string | null;
}

/**
 * Link a phone to the agent on WhatsApp: a one-time code the person sends
 * from that phone. The page checks every few seconds until the link shows up.
 */
export function WhatsAppLink({ status, refresh }: { status: WhatsAppStatus; refresh: () => Promise<unknown> }) {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState<'code' | 'unlink' | null>(null);
  const linkedAt = status.linked?.linkedAt;
  const startedWith = React.useRef<string | null | undefined>(undefined);

  // While a code is out, look for the new link; stop when it lands or the code expires.
  React.useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (Date.now() > Date.parse(pending.expiresAt)) setPending(null);
      else void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, refresh]);
  React.useEffect(() => {
    if (pending && linkedAt && linkedAt !== startedWith.current) {
      setPending(null);
      toast.success('WhatsApp linked');
    }
  }, [pending, linkedAt]);

  async function getCode() {
    setBusy('code');
    try {
      startedWith.current = linkedAt ?? null;
      setPending(await api<Pending>('/api/account/whatsapp', { method: 'POST' }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function cancelCode() {
    setPending(null);
    // The code stops working on the server too, not just on this page.
    await api('/api/account/whatsapp?code=1', { method: 'DELETE' }).catch((e: Error) => toast.error(e.message));
  }

  async function unlinkPhone() {
    setBusy('unlink');
    try {
      await api('/api/account/whatsapp', { method: 'DELETE' });
      setPending(null);
      await refresh();
      toast.success('WhatsApp unlinked');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {status.linked ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="success" icon={MessageCircle}>
            Linked
          </Badge>
          <span className="text-sm font-medium">{status.linked.number}</span>
          <Button size="sm" variant="outline" loading={busy === 'unlink'} onClick={unlinkPhone}>
            Unlink
          </Button>
          {!pending && (
            <Button size="sm" variant="outline" loading={busy === 'code'} onClick={getCode}>
              Link a different phone
            </Button>
          )}
        </div>
      ) : (
        !pending && (
          <Button loading={busy === 'code'} onClick={getCode}>
            <MessageCircle aria-hidden /> Link my WhatsApp
          </Button>
        )
      )}

      {pending && (
        <div className="space-y-3 rounded-xl border p-4 text-sm sm:max-w-md">
          <p>
            From the phone you want to use, send this message{pending.staffNumber ? <> to <span className="font-medium">{pending.staffNumber}</span></> : ' to the hotel team’s WhatsApp number'}:
          </p>
          <p className="font-mono text-lg tracking-wider">LINK {pending.code}</p>
          <div className="flex flex-wrap gap-2">
            {pending.chatUrl && (
              <Button asChild size="sm">
                <a href={pending.chatUrl} target="_blank" rel="noreferrer">
                  Open WhatsApp
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={cancelCode}>
              Cancel
            </Button>
          </div>
          <p className="text-muted-foreground">The code works once, for 10 minutes. This page updates when the phone is linked.</p>
        </div>
      )}
    </div>
  );
}
