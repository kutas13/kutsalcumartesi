import './globals.css';

export const metadata = {
  title: 'Kutsal Cumartesi Kasa',
  description: 'Kasa, cari, borç ve yatırım hesapları için özel finans paneli.'
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4f7fb'
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
