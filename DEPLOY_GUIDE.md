# 🚀 Panduan Deploy Portfolio ke GitHub Pages

## Langkah-langkah Deploy

### 1. Persiapan Repository GitHub

1. **Login ke GitHub** dan buat repository baru dengan nama `foxrider1998.github.io`
   - Repository harus public
   - Nama harus sesuai dengan username GitHub Anda

2. **Clone repository** (jika sudah ada) atau inisialisasi Git:
   ```bash
   git clone https://github.com/foxrider1998/foxrider1998.github.io.git
   cd foxrider1998.github.io
   ```

### 2. Upload Files Portfolio

1. **Copy semua file** dari folder portofolio ini ke repository GitHub Pages:
   ```bash
   cp -r /Users/aris/portofolio/* /path/to/foxrider1998.github.io/
   ```

2. **Atau gunakan script deploy otomatis**:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

### 3. Manual Deploy (jika tidak menggunakan script)

```bash
# Masuk ke folder repository
cd foxrider1998.github.io

# Add semua file
git add .

# Commit dengan pesan
git commit -m "Add professional portfolio with role-based projects"

# Push ke GitHub
git push origin main
```

### 4. Aktivasi GitHub Pages

1. **Buka repository** di GitHub
2. **Masuk ke Settings** > **Pages**
3. **Source**: Deploy from a branch
4. **Branch**: main
5. **Folder**: / (root)
6. **Save**

### 5. Tunggu Deployment

- GitHub akan otomatis deploy portfolio Anda
- Proses ini biasanya memakan waktu 5-10 menit
- Portfolio akan tersedia di: `https://foxrider1998.github.io`

## 🎯 Fitur Portfolio Yang Dibuat

### ✅ Struktur Role-based
- **QA Engineer**: API Testing, Web Automation, E2E Testing
- **Data Science**: ML Models, Predictive Analytics, Computer Vision
- **Automation**: RPA, IoT Systems, Test Frameworks
- **Mobile Testing**: React Native, Cross-platform Testing

### ✅ Teknologi Modern
- Responsive Design (Bootstrap 5)
- Smooth Animations & Transitions
- SEO Optimized
- PWA Ready
- Fast Loading

### ✅ Professional Features
- Contact Information
- Social Media Links
- Project Showcase
- Skills Matrix
- Professional About Section

## 🔧 Kustomisasi Portfolio

### Update Informasi Personal
Edit file `index.html` dan ubah:
- Nama dan title
- Deskripsi personal
- Contact information
- Social media links

### Tambah Project Baru
1. Buka section projects di `index.html`
2. Copy struktur project card yang sudah ada
3. Update informasi project:
   - Judul project
   - Deskripsi
   - Tech stack
   - Link repository/demo

### Update Skills
Edit section skills untuk menambah/mengurangi keahlian:
```html
<div class="skill-category">
    <i class="fas fa-icon-name"></i>
    <h4>Category Name</h4>
    <ul class="skill-list">
        <li>Skill 1</li>
        <li>Skill 2</li>
    </ul>
</div>
```

## 📊 SEO & Performance

### Sudah Termasuk:
- ✅ Meta tags untuk SEO
- ✅ Open Graph tags
- ✅ Twitter Card
- ✅ Structured Data (JSON-LD)
- ✅ Sitemap.xml
- ✅ Robots.txt
- ✅ Fast loading images
- ✅ Mobile-first design

### Analytics (Opsional)
Tambahkan Google Analytics dengan mengganti `GA_TRACKING_ID` di script.

## 🔄 Update Portfolio

Untuk update konten portfolio:

1. **Edit files** yang dibutuhkan
2. **Commit & push**:
   ```bash
   git add .
   git commit -m "Update portfolio content"
   git push origin main
   ```
3. **GitHub Pages akan otomatis update** dalam beberapa menit

## 📱 Testing

### Local Testing
Buka `index.html` di browser atau gunakan live server:
```bash
# Jika punya Python
python -m http.server 8000

# Atau jika punya Node.js
npx http-server
```

### Mobile Testing
- Test di berbagai device menggunakan browser dev tools
- Portfolio sudah responsive untuk semua ukuran layar

## 🎨 Color Scheme

Portfolio menggunakan tema professional:
- **Primary**: #2563eb (Blue)
- **Secondary**: #1e40af (Dark Blue)
- **Accent**: #3b82f6 (Light Blue)
- **Text**: #1f2937 (Dark Gray)
- **Background**: #f8fafc (Light Gray)

## 📞 Support

Jika ada pertanyaan atau butuh bantuan:
- **WhatsApp**: [+62 857 4301 9186](https://api.whatsapp.com/send?phone=6285743019186&text=Hello%20Aris!)
- **GitHub**: [foxrider1998](https://github.com/foxrider1998)
- **Email**: arisperma.dev@gmail.com

---

**Selamat!** 🎉 Portfolio profesional Anda siap untuk keperluan lamaran kerja!
