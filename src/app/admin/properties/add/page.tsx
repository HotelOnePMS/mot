'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/fetcher';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout, PageHeader } from '@/components/ui/primitives';
import { EMPTY_PROPERTY, PropertyFields, errorSummary, propertyErrors, toPropertyPayload, type PropertyDraft } from '@/components/setup/PropertyFields';
import { useConsole } from '@/components/console/ConsoleProvider';

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

export default function AddPropertyPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { setPropertyId } = useConsole();
  const [draft, setDraft] = React.useState<PropertyDraft>(EMPTY_PROPERTY);
  // Field errors show once someone has tried to save, then update as they type.
  const [tried, setTried] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const errors = tried ? propertyErrors(draft) : {};
  const summary = errorSummary(errors);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setServerError(null);
    if (Object.keys(propertyErrors(draft)).length) {
      // Take people to the first field that needs fixing.
      requestAnimationFrame(() => {
        const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        first?.focus();
        first?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    setSaving(true);
    try {
      const created = await api<{ id: string; name: string }>('/api/admin/properties', { method: 'POST', json: toPropertyPayload(draft) });
      await mutate('/api/admin/context');
      setPropertyId(created.id);
      toast.success(`${created.name} created — now add its rooms`);
      router.push('/admin/room-types/add');
    } catch (err) {
      setServerError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className={FRAME}>
      <div className="max-w-4xl space-y-6">
        <Link
          href="/admin/properties"
          className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden /> Properties
        </Link>
        <PageHeader title="Add a property" description="The basics guests need. Rooms, photos and rates come next." />
        <form ref={formRef} onSubmit={save} className="space-y-6" noValidate>
          <Card className="p-5 sm:p-8">
            <PropertyFields value={draft} onChange={setDraft} errors={errors} />
          </Card>
          {(serverError || summary) && (
            <Callout tone="danger" title={serverError ? 'We couldn’t create the property' : 'Please check the form'} role="alert">
              {serverError ?? summary}
            </Callout>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} loadingText="Creating your property…">
              Create property
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
