"use client";

import { useEffect, useRef } from "react";

const SUPPORT_ORIGIN = "https://support.cadabracraft.com";
// The form's own height report is the frame's current height, not its content's, so the frame never grows by itself.
// 700 px holds the whole form, with the Send button, at desktop and phone widths (checked on the live page).
const FRAME_HEIGHT = 700;

/**
 * The contact form from the support desk (SupDesk), embedded with its own script. The script puts the form's frame
 * right after itself, so it is added to this box once the page has loaded and taken away again on unmount. Without
 * JavaScript the same form is a plain frame. Only the Support page loads it.
 */
export function ContactForm() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const script = document.createElement("script");
    script.src = `${SUPPORT_ORIGIN}/embed.js`;
    script.async = true;
    script.dataset.supdesk = "contact";
    script.dataset.title = "Contact CadabraCraft";
    script.dataset.height = String(FRAME_HEIGHT);
    el.appendChild(script);
    return () => {
      el.replaceChildren();
    };
  }, []);
  return (
    <div ref={box} className="mx-auto mt-6 w-full text-left">
      <noscript>
        <iframe
          src={`${SUPPORT_ORIGIN}/embed/contact`}
          title="Contact CadabraCraft"
          width="100%"
          height={FRAME_HEIGHT}
          style={{ border: 0 }}
        />
      </noscript>
    </div>
  );
}
