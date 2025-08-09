/* =========================
   Prayer Widget (Aladhan by City)
   - Fixed di kanan atas (desktop), tidak nabrak foto
   - Mobile (<=768px): di bawah navbar, non-fixed
   - Hide/Show dengan tombol (ingat status via localStorage)
   - Geolocation -> reverse geocode (Nominatim) -> timingsByCity
   - Fallback: Jakarta, Indonesia
   ========================= */

(function () {
  /* ---------- Inject CSS ---------- */
  const css = `
  .prayer-widget{position:fixed;top:140px;right:20px;width:260px;z-index:1061;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.12);overflow:hidden;font-family:'Poppins',sans-serif}
  .prayer-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 12px;background:linear-gradient(135deg,var(--primary-color,#2563eb),var(--secondary-color,#1e40af));color:#fff}
  .prayer-header .title{font-weight:700;font-size:14px;letter-spacing:.4px}
  .prayer-header .sub{font-size:11px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}
  .prayer-hide-btn{appearance:none;border:0;outline:0;width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.18);color:#fff;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .prayer-hide-btn:hover{background:rgba(255,255,255,.28)}
  .prayer-body{padding:10px 12px 6px;max-height:60vh;overflow-y:auto}
  .prayer-row{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;margin:6px 0;border-radius:10px;background:#f8fafc;color:#374151;font-weight:600;font-size:13px}
  .prayer-row.next{outline:2px solid var(--primary-color,#2563eb);background:#eef2ff}
  .prayer-footer{padding:10px 12px 12px;border-top:1px solid #eef2f7;font-size:12px;color:#475569}
  .prayer-footer strong{color:#111827}
  [data-theme="dark"] .prayer-widget{background:#111827;border-color:#334155}
  [data-theme="dark"] .prayer-row{background:#0b1220;color:#cbd5e1}
  [data-theme="dark"] .prayer-row.next{background:#0f1b35}
  [data-theme="dark"] .prayer-footer{border-color:#1f2a44;color:#94a3b8}
  @media (max-width:768px){
    .prayer-widget{position:static;width:auto;max-width:960px;margin:8px 12px 0}
    .prayer-header .sub{max-width:unset}
  }`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- Build DOM ---------- */
  const wrap = document.createElement('div');
  wrap.className = 'prayer-widget';
  wrap.id = 'prayerWidget';
  wrap.innerHTML = `
    <div class="prayer-header">
      <div>
        <div class="title">Jadwal Sholat Hari Ini</div>
        <div class="sub" id="prayerLocation">Mendeteksi lokasi…</div>
      </div>
      <button class="prayer-hide-btn" id="prayerToggleBtn" title="Hide/Show" aria-expanded="true">–</button>
    </div>
    <div class="prayer-body" id="prayerBody">
      <div class="prayer-row"><span class="name">Subuh</span><span id="fajr">--:--</span></div>
      <div class="prayer-row"><span class="name">Dzuhur</span><span id="dhuhr">--:--</span></div>
      <div class="prayer-row"><span class="name">Ashar</span><span id="asr">--:--</span></div>
      <div class="prayer-row"><span class="name">Maghrib</span><span id="maghrib">--:--</span></div>
      <div class="prayer-row"><span class="name">Isya</span><span id="isha">--:--</span></div>
    </div>
    <div class="prayer-footer" id="prayerFooter">
      <div>Berikutnya: <strong id="nextPrayer">-</strong></div>
      <div id="countdown">00:00:00</div>
    </div>
  `;
  document.body.appendChild(wrap);

  const q = sel => wrap.querySelector(sel);
  const locEl = q('#prayerLocation');
  const nextEl = q('#nextPrayer');
  const countdownEl = q('#countdown');
  const bodyEl = q('#prayerBody');
  const footerEl = q('#prayerFooter');
  const btn = q('#prayerToggleBtn');
  const setTxt = (id, v) => q('#' + id).textContent = v;

  /* ---------- Hide / Show (remember state) ---------- */
  function applyHiddenState(hidden) {
    if (hidden) {
      bodyEl.style.display = 'none';
      footerEl.style.display = 'none';
      btn.textContent = '+';
      btn.setAttribute('aria-expanded', 'false');
    } else {
      bodyEl.style.display = '';
      footerEl.style.display = '';
      btn.textContent = '–';
      btn.setAttribute('aria-expanded', 'true');
    }
  }
  const savedHidden = localStorage.getItem('prayer_hidden') === '1';
  applyHiddenState(savedHidden);
  btn.addEventListener('click', () => {
    const nowHidden = bodyEl.style.display !== 'none';
    localStorage.setItem('prayer_hidden', nowHidden ? '1' : '0');
    applyHiddenState(nowHidden);
  });

  /* ---------- Mobile placement (under navbar) ---------- */
  function moveForMobile() {
    const isMobile = window.innerWidth <= 768;
    const navbar = document.querySelector('.navbar');
    if (isMobile && navbar && wrap.previousElementSibling !== navbar) {
      navbar.parentNode.insertBefore(wrap, navbar.nextSibling);
    } else if (!isMobile && wrap.parentNode !== document.body) {
      document.body.appendChild(wrap);
    }
  }
  moveForMobile();
  window.addEventListener('resize', moveForMobile);

  /* ---------- Geolocation + Reverse Geocode ---------- */
  function getPosition() {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 6000 }
      );
    });
  }

  async function reverseGeocode(lat, lon) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'id' } });
    const json = await res.json();
    const a = json.address || {};
    const city = a.city || a.town || a.municipality || a.village || a.state_district || a.state || 'Jakarta';
    const country = a.country || 'Indonesia';
    // tampilkan provinsi kalau ada
    const region = a.state || a.region || '';
    return { city, country, region };
  }

  async function getCityCountry() {
    try {
      const p = await getPosition();
      if (p) return await reverseGeocode(p.lat, p.lon);
    } catch (_) {}
    return { city: 'Jakarta', country: 'Indonesia', region: 'DKI Jakarta' };
  }

  /* ---------- Fetch timings by city (Aladhan) ---------- */
  async function fetchTimingsByCity(city, country) {
    const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=20`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.code !== 200) throw new Error('Aladhan error');
    return json.data;
  }

  /* ---------- Next prayer + countdown ---------- */
  function computeNext(timings) {
    const map = [
      ['Fajr','Subuh','fajr'],
      ['Dhuhr','Dzuhur','dhuhr'],
      ['Asr','Ashar','asr'],
      ['Maghrib','Maghrib','maghrib'],
      ['Isha','Isya','isha']
    ];
    const now = new Date();
    wrap.querySelectorAll('.prayer-row').forEach(el => el.classList.remove('next'));

    const parseHM = (s) => {
      const m = String(s).match(/(\d{1,2}):(\d{2})/);
      if (!m) return [0, 0];
      return [parseInt(m[1], 10), parseInt(m[2], 10)];
    };

    let nextTime = null, nextKey = null, nextLabel = null;
    for (const [key, label] of map) {
      const [h, m] = parseHM(timings[key]);
      const t = new Date(now); t.setHours(h, m, 0, 0);
      if (t > now) { nextTime = t; nextKey = key; nextLabel = label; break; }
    }
    if (!nextTime) {
      const [h, m] = parseHM(timings['Fajr']);
      nextTime = new Date(now); nextTime.setDate(now.getDate() + 1); nextTime.setHours(h, m, 0, 0);
      nextKey = 'Fajr'; nextLabel = 'Subuh';
    }

    const idMap = {Fajr:'fajr', Dhuhr:'dhuhr', Asr:'asr', Maghrib:'maghrib', Isha:'isha'};
    const rows = Array.from(wrap.querySelectorAll('.prayer-body .prayer-row'));
    const idx = ['fajr','dhuhr','asr','maghrib','isha'].indexOf(idMap[nextKey]);
    if (idx >= 0) rows[idx].classList.add('next');

    nextEl.textContent = `${nextLabel} • ${timings[nextKey]}`;

    if (window.__prayerCountdown) clearInterval(window.__prayerCountdown);
    window.__prayerCountdown = setInterval(() => {
      const diff = nextTime - new Date();
      if (diff <= 0) { clearInterval(window.__prayerCountdown); init(); return; }
      const hh = String(Math.floor(diff / 3_600_000)).padStart(2, '0');
      const mm = String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2, '0');
      const ss = String(Math.floor((diff % 60_000) / 1000)).padStart(2, '0');
      countdownEl.textContent = `${hh}:${mm}:${ss}`;
    }, 1000);
  }

  /* ---------- Init ---------- */
  async function init() {
    try {
      const { city, country, region } = await getCityCountry();
      locEl.textContent = region ? `${region}, ${country}` : `${city}, ${country}`;

      const data = await fetchTimingsByCity(city, country);
      const t = data.timings;

      // Fill times
      setTxt('fajr', t.Fajr);
      setTxt('dhuhr', t.Dhuhr);
      setTxt('asr', t.Asr);
      setTxt('maghrib', t.Maghrib);
      setTxt('isha', t.Isha);

      computeNext(t);
    } catch (e) {
      console.error('Prayer widget error:', e);
      locEl.textContent = 'Gagal memuat jadwal (fallback Jakarta)';
      try {
        const data = await fetchTimingsByCity('Jakarta', 'Indonesia');
        const t = data.timings;
        setTxt('fajr', t.Fajr);
        setTxt('dhuhr', t.Dhuhr);
        setTxt('asr', t.Asr);
        setTxt('maghrib', t.Maghrib);
        setTxt('isha', t.Isha);
        computeNext(t);
      } catch (e2) {
        q('#prayerBody').innerHTML = '<div style="padding:10px;color:#ef4444">Tidak bisa memuat jadwal.</div>';
      }
    }
  }

  init();
})();
