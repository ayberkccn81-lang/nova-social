# NOVA — gerçek backend başlangıç sürümü

Bu proje, yalnızca tarayıcıda çalışan demo yerine Node.js + Express + SQLite kullanan bir sosyal medya başlangıç projesidir.

## Gerekenler
- Node.js 20 veya üzeri (bilgisayar için)
- Terminal / Komut İstemi
- İlk kurulumda internet bağlantısı (npm paketlerini indirmek için)

## Windows'ta localhost ile çalıştırma
1. ZIP'i bilgisayarda bir klasöre çıkar.
2. Node.js LTS sürümünü https://nodejs.org adresinden kur.
3. Proje klasöründe boş bir alana Shift + sağ tık → Terminal/PowerShell aç.
4. Şu komutları sırayla çalıştır:

```bash
npm install
```

Sonra `.env.example` dosyasını `.env` olarak kopyalayıp içindeki `SESSION_SECRET` değerini uzun, rastgele bir değerle değiştir. (Yerelde bu adım olmadan da çalışır ama yayın öncesi zorunlu say.)
Ardından:

```bash
npm start
```

Tarayıcıda `http://localhost:3000` aç.

## Telefonundan test etme (aynı Wi-Fi)
Bilgisayar ve telefon aynı Wi-Fi ağında olmalı. Bilgisayarın yerel IP adresini öğren:
- Windows: `ipconfig` → Wi-Fi adaptöründeki IPv4 Address, örneğin `192.168.1.25`
- Telefonda Chrome'a `http://192.168.1.25:3000` yaz.
Windows Güvenlik Duvarı sorarsa Node.js için özel ağ erişimine izin ver. Bu adres yalnızca aynı ağda çalışır; dışarıdaki arkadaşların ulaşamaz.

## Gerçekten herkesin girebilmesi
Projeyi internete deploy etmek gerekir. Örneğin Render/Railway gibi Node.js hostlarına yüklenebilir. Yayına çıkmadan önce:
- `SESSION_SECRET` ortam değişkenini güçlü ve rastgele bir değerle ayarla.
- HTTPS kullan.
- SQLite veritabanı için kalıcı disk yapılandır. Kalıcı disk olmayan ücretsiz/ephemeral hostlarda yeniden başlatmada veriler kaybolabilir.
- Express'in varsayılan MemoryStore oturum deposu yalnızca geliştirme içindir. Yayın öncesi Redis veya SQLite tabanlı session store kullan.
- Dosya yükleme bu ilk backend sürümünde yok; gönderiler yalnızca yazı ve herkese açık medya URL'si destekler.
- Gerçek üretim için e-posta doğrulama, şifre sıfırlama, CSRF koruması, moderasyon/şikâyet, gizlilik metni ve yedekleme ekle.

## Bu sürümde var
- Gerçek kayıt/giriş; şifreler bcrypt ile hash'lenir
- SQLite veritabanında kullanıcılar, gönderiler, beğeniler, takipler ve mesajlar
- Profil düzenleme
- Gönderi arama ve kullanıcı arama
- Takip etme/takipten çıkma
- Kullanıcılar arası özel mesajlar (sayfayı yenileyerek yeni mesajları görür)
- Mobil uyumlu koyu tasarım

## Önemli
Bu bir başlangıç projesidir, tam üretim güvenlik incelemesinden geçmemiştir. Gerçek kişilerin kullanacağı şekilde geniş çapta paylaşmadan önce hosting, kalıcı veri, oturum deposu ve güvenlik kontrolleri tamamlanmalıdır.
