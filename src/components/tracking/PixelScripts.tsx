'use client';

import { useEffect } from 'react';
import Script from 'next/script';
import { captureUtmParameters } from '@/lib/tracking/client';

/**
 * PixelScripts Component
 *
 * Injects Meta Pixel, Google Tag (gtag.js), and Snapchat Pixel scripts
 * safely with Next.js Script strategy="afterInteractive".
 */
interface PixelScriptsProps {
  metaPixelId?: string | null;
  googleTagId?: string | null;
  snapPixelId?: string | null;
}

export default function PixelScripts({
  metaPixelId: propMetaPixelId,
  googleTagId: propGoogleTagId,
  snapPixelId: propSnapPixelId,
}: PixelScriptsProps = {}) {
  useEffect(() => {
    captureUtmParameters();
  }, []);

  const metaPixelId = propMetaPixelId || process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const googleTagId = propGoogleTagId || process.env.NEXT_PUBLIC_GOOGLE_TAG_ID || process.env.NEXT_PUBLIC_GA_ID;
  const snapPixelId = propSnapPixelId || process.env.NEXT_PUBLIC_SNAP_PIXEL_ID;

  return (
    <>
      {/* 1. Meta Pixel */}
      {metaPixelId && (
        <Script id="meta-pixel-init" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${metaPixelId}');
            fbq('track', 'PageView');
          `}
        </Script>
      )}

      {/* 2. Google Tag (gtag.js) */}
      {googleTagId && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${googleTagId}`}
            strategy="afterInteractive"
          />
          <Script id="google-tag-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              gtag('config', '${googleTagId}', {
                send_page_view: true
              });
            `}
          </Script>
        </>
      )}

      {/* 3. Snapchat Pixel */}
      {snapPixelId && (
        <Script id="snapchat-pixel-init" strategy="afterInteractive">
          {`
            (function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function()
            {a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};
            a.queue=[];var s='script';var r=t.createElement(s);r.async=!0;
            r.src=n;var u=t.getElementsByTagName(s)[0];
            u.parentNode.insertBefore(r,u);})(window,document,
            'https://sc-static.net/scevent.min.js');

            snaptr('init', '${snapPixelId}');
            snaptr('track', 'PAGE_VIEW');
          `}
        </Script>
      )}
    </>
  );
}

