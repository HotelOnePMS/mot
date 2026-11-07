import { z } from 'zod';
import { ID_TYPES } from '@/lib/card-authorization';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// HELD: the security deposit was already taken (desk payments); NONE: check in without one.
export const depositChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('HELD') }),
  z.object({ kind: z.literal('NONE'), reason: z.string().trim().max(200).nullish() }),
]);

export const registrationDraftSchema = z.object({
  roomId: z.string().min(1).max(64).nullable(),
  guestAddress: z.string().trim().max(300).nullable(),
  id: z.object({ idType: z.enum(ID_TYPES), country: z.string().regex(/^[A-Za-z]{2}$/).nullable(), last4: z.string().regex(/^[A-Za-z0-9]{4}$/) }),
  deposit: depositChoiceSchema,
});

export const guidedCheckInSchema = z.object({
  id: z.object({
    source: z.enum(['SCAN_AAMVA', 'SCAN_MRZ', 'MANUAL']),
    idType: z.enum(ID_TYPES),
    nameOnId: z.string().trim().min(2).max(120),
    documentNumber: z.string().trim().min(4).max(30),
    country: z.string().regex(/^[A-Za-z]{2}$/),
    region: z.string().trim().max(10).nullish(),
    expiresOn: isoDay.nullish(),
    dateOfBirth: isoDay.nullish(),
    address: z
      .object({ line1: z.string().trim().max(200), city: z.string().trim().max(100), region: z.string().trim().max(50), postalCode: z.string().trim().max(20), country: z.string().max(2).nullable() })
      .nullish(),
    sex: z.enum(['M', 'F', 'X']).nullish(),
    nationality: z.string().max(2).nullish(),
    // A data URL; the screen shrinks photos to well under this.
    photo: z.string().max(3_500_000).nullish(),
    confirmed: z.boolean(),
    overrideReason: z.string().trim().max(300).nullish(),
  }),
  roomId: z.string().min(1).max(64).nullish(),
  allowDirtyRoom: z.boolean().optional(),
  deposit: depositChoiceSchema,
  guestAddress: z.string().trim().max(300).nullish(),
  registration: z.object({
    textHash: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.discriminatedUnion('method', [
      z.object({ method: z.literal('DRAWN'), image: z.string().max(420_000) }),
      z.object({ method: z.literal('TYPED'), text: z.string().trim().min(2).max(120) }),
    ]),
    consent: z.literal(true, { errorMap: () => ({ message: 'The guest needs to agree before signing' }) }),
  }),
});
