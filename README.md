# ดูด้วยกัน (Watch Together)

คิวหนังและซีรีส์ที่ใช้ร่วมกันสองคน: track ว่าดูถึงตอนไหน, คิว watch later, ให้คะแนนและรีวิวกันเอง, ดึงคะแนน IMDb / Rotten Tomatoes / Metacritic, ทุนสร้างและรายได้, ผู้กำกับ นักแสดง และกราฟคะแนนรายตอน

เว็บล้วน (HTML/CSS/JS ไม่มี build step) โฮสต์บน GitHub Pages, ข้อมูลร่วมเก็บใน Supabase (ฟรี)

## ตั้งค่าครั้งแรก

1. **Supabase:** สร้างโปรเจกต์ที่ https://supabase.com/dashboard
   - SQL Editor → วางไฟล์ [`supabase/schema.sql`](supabase/schema.sql) → Run
   - Authentication → URL Configuration → ใส่ URL ของเว็บ (GitHub Pages) ใน **Site URL** และ **Redirect URLs**
     (หรือปิด *Confirm email* ใน Authentication → Providers → Email ถ้าไม่อยากยืนยันอีเมล)
   - Project Settings → API → คัดลอก **Project URL** และ **anon public key** ใส่ใน [`config.js`](config.js)
     (ถ้าไม่ใส่ แอปจะถามตอนเปิดครั้งแรกแล้วจำไว้ในเครื่อง)
2. **TMDb key (จำเป็น):** https://www.themoviedb.org/settings/api
3. **OMDb key (ไม่บังคับ, ใช้ดึงคะแนน IMDb/RT/Metacritic):** https://www.omdbapi.com/apikey.aspx
4. เปิดเว็บ → สมัคร → สร้างลิสต์ → ⚙ ตั้งค่า → ใส่ TMDb/OMDb key (เก็บใน Supabase ไม่อยู่ใน repo) → คัดลอกลิงก์ชวนส่งให้แฟน

## ใช้บนมือถือ

เปิดเว็บแล้ว "เพิ่มลงหน้าจอโฮม" บน Android ที่ติดตั้งแล้วจะกด **แชร์** ลิงก์ IMDb จากแอปอื่นเข้ามาได้เลย
ช่องค้นหารับลิงก์ IMDb (`tt1234567`) หรือลิงก์ TMDb ได้ด้วย

## รันในเครื่อง

```
python -m http.server 5178
```

## Deploy

push ขึ้น `main` แล้ว GitHub Actions ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)) จะ deploy ไป GitHub Pages ให้เอง

---
This product uses the TMDB API but is not endorsed or certified by TMDB.
