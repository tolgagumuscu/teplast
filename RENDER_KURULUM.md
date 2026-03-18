# Teplast — Render.com Deploy Kılavuzu

## Gereksinimler
- Render.com hesabı (ücretsiz)
- GitHub hesabı (ücretsiz)

---

## ADIM 1 — GitHub'a yükle

1. github.com → "New repository" → isim: `teplast` → Create
2. Terminalde:
```bash
cd teplast-render/
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/KULLANICI_ADIN/teplast.git
git push -u origin main
```

---

## ADIM 2 — Redis Key Value oluştur

1. dashboard.render.com → **New** → **Key Value**
2. Name: `teplast-kv`
3. Plan: **Free**
4. Region: **Frankfurt (EU Central)** ← Türkiye'ye en yakın
5. **Create Key Value** tıkla
6. Oluşunca → **Connect** bölümünden **Internal URL**'yi kopyala
   → `redis://red-xxxx...`

---

## ADIM 3 — Web Service oluştur

1. **New** → **Web Service**
2. **Connect a repository** → GitHub'daki `teplast` repo'sunu seç
3. Ayarlar:
   - Name: `teplast`
   - Region: **Frankfurt (EU Central)**
   - Branch: `main`
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: **Free**

4. **Environment Variables** bölümüne ekle:
   ```
   REDIS_URL = [Adım 2'den kopyaladığın Internal URL]
   ```

5. **Create Web Service** tıkla

---

## ADIM 4 — Uygulama ayarları

1. Deploy bitince `https://teplast.onrender.com` adresine git
2. **Ayarlar** sayfasına gir
3. Mail bilgilerini doldur (host, port, kullanıcı, şifre)
4. **Kaydet**

**Proxy URL'yi boş bırak** — Render'da sayfa ve sunucu aynı adreste.

---

## ADIM 5 — Otomatik tarama (isteğe bağlı)

Render ücretsiz tier 15 dakika işlem yapılmazsa uyuya kalır.
Bunu önlemek için Ayarlar'da **Tarama Aralığı: Her 10 dakika** seç.
Bu hem siparişleri güncel tutar hem sunucuyu uyanık bırakır.

---

## Notlar

- **Ücretsiz tier limitleri:** Web Service ayda 750 saat çalışır (yeterli).
  Redis: 1 instance, 25MB. Binlerce sipariş için fazlasıyla yeterli.
- **Güncelleme:** Kodu değiştirip `git push` yapınca Render otomatik yeniden deploy eder.
- **LAN kullanımı:** Fabrika ağındaki PC'ler için eski localhost proxy hala çalışır.
  Render ve LAN aynı anda kullanılabilir — ikisi de aynı Redis'e bağlanır.
