import { useState } from 'react';
import { shareContent } from '../utils/share.js';

export function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51 15.42 17.49" />
      <path d="M15.41 6.51 8.59 10.49" />
    </svg>
  );
}

export function ShareBtn({ title, text, url, label="Share", className="", stopPropagation=false }) {
  const [status, setStatus] = useState("");
  const handle = async (event) => {
    if (stopPropagation) event.stopPropagation();
    const res = await shareContent({ title, text, url });
    if (res === "shared" || res === "copied") {
      setStatus(res === "shared" ? "Shared! " : "Copied! ");
      setTimeout(() => setStatus(""), 2500);
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      className={`flex items-center gap-2 font-bold transition-all ${className}`}
    >
      {status ? status : <><ShareIcon />{label}</>}
    </button>
  );
}
