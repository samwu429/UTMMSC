import type { ReactNode } from 'react';

/**
 * Line icons for the message popover, the jump pills and the timeline. They draw in currentColor.
 * 消息浮层、跳转胶囊和时间线使用的线条图标，颜色取自 currentColor。
 */

function Line({ children, className = 'h-6 w-6' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function CopyIcon() {
  return (
    <Line>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </Line>
  );
}

export function QuoteIcon() {
  return (
    <Line>
      <path d="M5 17.5h14M5 13.5h9" />
      <path d="M8.5 5.5c-1.9.6-3.2 2-3.5 4h3v-4ZM15.5 5.5c-1.9.6-3.2 2-3.5 4h3v-4Z" />
    </Line>
  );
}

export function RecallIcon() {
  return (
    <Line>
      <path d="M9 7.5 5 11.5l4 4" />
      <path d="M5 11.5h9.5a4.5 4.5 0 0 1 0 9H11" />
    </Line>
  );
}

export function DeleteIcon() {
  return (
    <Line>
      <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l.9 12.1a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </Line>
  );
}

export function TranslateIcon() {
  return (
    <Line>
      <path d="M4 6h8M8 4.5V6M10.5 6c-.6 3-2.6 5.6-5.5 7M6.5 9c1 1.7 2.5 3 4.5 3.8" />
      <path d="m12.5 20 3.5-8.5 3.5 8.5M13.8 17h4.4" />
    </Line>
  );
}

export function RemoveForAllIcon() {
  return (
    <Line>
      <circle cx="12" cy="12" r="7.5" />
      <path d="m6.8 6.8 10.4 10.4" />
    </Line>
  );
}

export function MuteIcon() {
  return (
    <Line>
      <path d="M5 6.5h11a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H10l-3.5 3v-3H5A1.5 1.5 0 0 1 3.5 14.5V8A1.5 1.5 0 0 1 5 6.5Z" />
      <path d="m3 3.5 18 17" />
    </Line>
  );
}

export function ChevronUpIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Line className={className}>
      <path d="m6 14 6-6 6 6" />
    </Line>
  );
}

export function ChevronDownIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Line className={className}>
      <path d="m6 10 6 6 6-6" />
    </Line>
  );
}

export function CloseIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Line className={className}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Line>
  );
}
