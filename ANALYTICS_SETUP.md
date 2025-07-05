# 📊 Portfolio Visitor Analytics Setup Guide

Sistem analytics ini akan memberikan notifikasi real-time ketika ada pengunjung di portofolio Anda.

## 🎯 Fitur Yang Tersedia

### 1. **Real-time Visitor Tracking**
- Deteksi pengunjung baru otomatis
- Informasi device, browser, OS, lokasi
- Tracking interaksi (klik button, download CV, dll)
- Session tracking dan visitor count

### 2. **Dashboard Analytics**
- Button analytics di pojok kiri bawah (📊)
- Real-time visitor statistics
- Export data analytics ke JSON
- Clear analytics data

### 3. **Notification Options**

#### A. **Telegram Notifications** 🤖
**Setup:**
1. Buka Telegram, chat dengan @BotFather
2. Ketik `/newbot` dan ikuti instruksi
3. Copy Bot Token yang diberikan
4. Chat dengan @userinfobot untuk dapat Chat ID Anda
5. Edit `analytics-config.js`:
   ```javascript
   telegram: {
       enabled: true,
       botToken: 'YOUR_BOT_TOKEN_HERE',
       chatId: 'YOUR_CHAT_ID_HERE',
   }
   ```

#### B. **Discord Notifications** 💬
**Setup:**
1. Buka Discord server Anda
2. Edit channel → Integrations → Webhooks
3. Create New Webhook
4. Copy Webhook URL
5. Edit `analytics-config.js`:
   ```javascript
   discord: {
       enabled: true,
       webhookUrl: 'YOUR_WEBHOOK_URL_HERE',
   }
   ```

#### C. **Email Notifications** 📧
**Setup (menggunakan EmailJS):**
1. Daftar di [emailjs.com](https://emailjs.com)
2. Buat Email Service (Gmail/Outlook/dll)
3. Buat Email Template
4. Copy Service ID, Template ID, dan Public Key
5. Edit `analytics-config.js`:
   ```javascript
   email: {
       enabled: true,
       serviceId: 'YOUR_SERVICE_ID',
       templateId: 'YOUR_TEMPLATE_ID', 
       publicKey: 'YOUR_PUBLIC_KEY',
       toEmail: 'areskretindo@gmail.com',
   }
   ```

#### D. **Google Analytics** 📈
**Setup:**
1. Buat Google Analytics account
2. Setup property untuk website
3. Copy Tracking ID
4. Edit `analytics-config.js`:
   ```javascript
   googleAnalytics: {
       enabled: true,
       trackingId: 'GA_TRACKING_ID_HERE',
   }
   ```

## 🚀 Quick Start (Tanpa Setup External Services)

Sistem analytics sudah aktif dengan fitur dasar:
- ✅ Console logging (buka Developer Tools untuk lihat)
- ✅ LocalStorage tracking
- ✅ Analytics dashboard
- ✅ Export functionality

## 📱 Cara Menggunakan

### 1. **Monitoring Real-time**
- Buka Developer Tools (F12) → Console
- Setiap pengunjung baru akan muncul log di console
- Informasi lengkap visitor ditampilkan dalam tabel

### 2. **Dashboard Analytics**
- Klik button 📊 di pojok kiri bawah
- Lihat statistik real-time
- Export data untuk analisis lebih lanjut

### 3. **Data Yang Dikumpulkan**
```javascript
{
  timestamp: "2025-01-06T10:30:00.000Z",
  localTime: "06/01/2025 17:30:00",
  device: "Desktop", // Desktop/Mobile/Tablet
  browser: "Chrome", // Chrome/Firefox/Safari/Edge
  os: "Windows", // Windows/MacOS/Linux/Android/iOS
  screenResolution: "1920x1080",
  timeZone: "Asia/Jakarta",
  referrer: "https://google.com", // Sumber traffic
  language: "id-ID",
  sessionId: "session_1234567890_xyz",
  interactions: [...] // Semua klik dan aktivitas
}
```

## 🔧 Kustomisasi

### Mengubah Tampilan Notifikasi
Edit fungsi `sendVisitorData()` di `index.html` untuk format pesan custom.

### Menambah Tracking Events
Edit fungsi `trackUserInteractions()` untuk track events tambahan.

### Mengubah Retensi Data
Edit `localStorage.retentionDays` di config untuk mengatur berapa lama data disimpan.

## 🛡️ Privacy & Security

- Data disimpan di browser visitor (localStorage)
- Tidak ada data personal sensitif yang dikumpulkan
- Visitor bisa clear data kapan saja
- Notifikasi bersifat anonim

## 🎯 Tips Optimalisasi

1. **Untuk Traffic Tinggi**: Aktifkan Google Analytics
2. **Untuk Monitoring Real-time**: Gunakan Telegram/Discord
3. **Untuk Laporan Berkala**: Gunakan Email notifications
4. **Untuk Development**: Gunakan Console logging

## 📞 Support

Jika ada pertanyaan atau butuh bantuan setup:
- Email: areskretindo@gmail.com
- WhatsApp: +62 857-4301-9186

---
**Note**: File ini adalah panduan lengkap. Anda bisa mulai dengan fitur dasar dan menambah notifikasi external sesuai kebutuhan.
