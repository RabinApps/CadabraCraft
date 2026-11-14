"use client";

import { useEffect, useRef } from "react";

const SUPPORT_ORIGIN = "https://support.cadabracraft.com";

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
    script.dataset.height = "520";
    el.appendChild(script);
    return () => {
      el.replaceChildren();
    };
  }, []);
  return (
    <div ref={box} className="mt-6">
      <noscript>
        <iframe
          src={`${SUPPORT_ORIGIN}/embed/contact`}
          title="Contact CadabraCraft"
          width="100%"
          height="520"
          style={{ border: 0 }}
        />
      </noscript>
    </div>
  );
}
