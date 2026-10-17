import { ImageResponse } from 'next/og';
import { PRODUCT_DOMAIN, PRODUCT_NAME, PRODUCT_TAGLINE } from '@/config/product';
import { BRAND_HEX, OgMark, loadBrandFonts } from '@/components/brand/og';

export const alt = `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The link preview for every page that doesn't set its own. */
export default async function OpengraphImage() {
  const fonts = await loadBrandFonts();
  const display = fonts.length ? 'Fraunces' : undefined;
  const text = fonts.length ? 'Inter' : undefined;
  const [lead, tail] = /^(.+?)([A-Z][^A-Z]*)$/.exec(PRODUCT_NAME)?.slice(1) ?? [PRODUCT_NAME, ''];

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: BRAND_HEX.background,
          color: BRAND_HEX.foreground,
          fontFamily: text,
          overflow: 'hidden',
        }}
      >
        {/* A giant crop of the mark: the keyhole as a door to the right. */}
        <div
          style={{
            position: 'absolute',
            right: -70,
            top: 56,
            width: 470,
            height: 518,
            borderRadius: 96,
            background: BRAND_HEX.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <OgMark size={420} square tile={BRAND_HEX.primary} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 80px', width: 780, height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <OgMark size={76} />
            <div style={{ display: 'flex', fontFamily: display, fontSize: 52, letterSpacing: -1 }}>
              <span style={{ fontWeight: 400 }}>{lead}</span>
              <span style={{ fontWeight: 600 }}>{tail}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontFamily: display, fontWeight: 600, fontSize: 66, lineHeight: 1.08, letterSpacing: -1.5 }}>{PRODUCT_TAGLINE}</div>
            <div style={{ display: 'flex', width: 120, height: 8, borderRadius: 4, background: BRAND_HEX.highlight, marginTop: 36 }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', fontSize: 26, color: BRAND_HEX.muted, whiteSpace: 'nowrap' }}>
            <span style={{ color: BRAND_HEX.primary, fontWeight: 600 }}>{PRODUCT_DOMAIN}</span>
            <span style={{ display: 'flex', width: 6, height: 6, borderRadius: 3, background: BRAND_HEX.highlight, margin: '0 16px' }} />
            <span>Direct booking + an AI front desk</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined }
  );
}
