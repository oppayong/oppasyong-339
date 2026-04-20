import { createClient } from '@supabase/supabase-js';
import CryptoJS from 'crypto-js';

export default async function handler(req, res) {
  // 從網址列取得你的專屬密碼 (例如：?key=你的密碼)
  const userKey = req.query.key;
  if (!userKey) return res.status(401).send('請在網址後方加上 ?key=密碼');

  const SUPABASE_URL = 'https://mezculqrqxwlmfxgrcru.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lemN1bHFycXh3bG1meGdyY3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjU0NjUsImV4cCI6MjA5MjI0MTQ2NX0.U8aAJs5wi2_wPNWeNRrucQH7gPH4rEJx9KfTgHljVZI';
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    // 抓取加密金庫
    const { data } = await supabase.from('activities').select('notes').eq('client_name', 'APP_VAULT_V1').limit(1);
    if (!data || data.length === 0) return res.status(404).send('尚無雲端資料');

    // 進行解密
    const encryptedStr = data[0].notes;
    const bytes = CryptoJS.AES.decrypt(encryptedStr, userKey);
    const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedStr) return res.status(401).send('密碼錯誤，解密失敗');
    
    const vault = JSON.parse(decryptedStr);
    const allActivities = vault.activities || {};

    // 轉換成 iPhone 支援的 iCalendar 格式
    let icsString = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//RongAn//339WarRoom//TW\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:南山339戰情室\r\nX-WR-TIMEZONE:Asia/Taipei\r\n`;

    Object.keys(allActivities).forEach(dateStr => {
      const datePart = dateStr.replace(/-/g, '');
      allActivities[dateStr].forEach((act, index) => {
        const startStr = act.time.replace(':', '') + '00';
        let hour = parseInt(act.time.split(':')[0]) + 1; // 預設 1 小時長度
        const endStr = `${hour.toString().padStart(2, '0')}0000`;
        
        icsString += `BEGIN:VEVENT\r\nUID:${datePart}-${startStr}-${index}@rongan\r\nDTSTAMP:${datePart}T${startStr}Z\r\nDTSTART;TZID=Asia/Taipei:${datePart}T${startStr}\r\nDTEND;TZID=Asia/Taipei:${datePart}T${endStr}\r\nSUMMARY:[${act.type}] ${act.clientName}\r\nDESCRIPTION:${act.notes}\r\nEND:VEVENT\r\n`;
      });
    });

    icsString += `END:VCALENDAR`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rongan-339.ics"');
    res.status(200).send(icsString);
  } catch (error) {
    res.status(500).send('伺服器錯誤');
  }
}
