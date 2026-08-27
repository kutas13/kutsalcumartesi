# Kutsal Cumartesi Kasa

Next.js 16 tabanlı özel finans paneli. Ortak veriler Supabase'de saklanır; oturum HttpOnly cookie ile, biyometrik giriş WebAuthn/Passkey ile çalışır.

## Vercel Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET`
- `KCK_YUSUF_PASSWORD`
- `KCK_OMER_PASSWORD`
- `KCK_TAHA_PASSWORD`
- `PASSKEY_RP_ID=kutsalcumartesi.com.tr`
- `PASSKEY_ORIGIN=https://kutsalcumartesi.com.tr`

Şifreler ve service-role anahtarı kaynak koduna yazılmaz.

## Face ID / Passkey

Önce şifre ile giriş yapılır. Oturum açıldıktan sonra `Face ID` butonuyla cihazda passkey kaydedilir. Sonraki girişlerde `Face ID / Passkey ile Gir` kullanılabilir.

Passkey alan adına bağlıdır; production kaydı `https://kutsalcumartesi.com.tr` üzerinde yapılmalıdır.

## Yetki

- Yusuf: tam yetki.
- Ömer ve Taha: görüntüleme; kendilerine tanımlı borç ödemesi için `Ödeme Yaptım` bildirimi gönderebilir.
- Ödeme bildirimi borcu düşürmez. Yusuf onayladığında cari giriş + borç hesabına transfer hareketleri oluşur ve borç azalır.
