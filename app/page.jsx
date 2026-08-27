import Script from 'next/script';
export default function Page(){return <><div id="loginRoot"/><div id="appRoot" className="hidden"/><div id="modalRoot"/><div id="toastRoot" className="toast-root"/><Script src="/legacy/app.js" strategy="afterInteractive"/></>}
