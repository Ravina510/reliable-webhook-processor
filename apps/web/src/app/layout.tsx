import type { ReactNode } from 'react';

export const metadata = {
  title: 'Reliable Webhook Processor',
  description: 'Webhook ingestion, queue operations, attempt history, and crash recovery dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        {children}
      </body>
    </html>
  );
}