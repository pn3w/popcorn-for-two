// ใส่ค่าจาก Supabase → Project Settings → API
// (anon key เปิดเผยได้ ข้อมูลถูกป้องกันด้วย Row Level Security ใน supabase/schema.sql)
// ถ้าเว้นว่าง แอปจะถามค่าเหล่านี้ตอนเปิดครั้งแรกแล้วจำไว้ในเครื่องแทน
window.WT_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
